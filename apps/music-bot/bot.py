import base64
import logging
import os
import random
import re
import time
from collections import deque
from dataclasses import dataclass

import aiohttp
import discord
import wavelink
from discord import app_commands

DISCORD_BOT_TOKEN = os.environ["DISCORD_BOT_TOKEN"]
DISCORD_GUILD_ID = int(os.environ["DISCORD_GUILD_ID"])
LAVALINK_URI = os.environ.get("LAVALINK_URI", "http://lavalink.music-bot.svc.cluster.local:2333")
LAVALINK_PASSWORD = os.environ["LAVALINK_PASSWORD"]
IDLE_TIMEOUT_SECONDS = int(os.environ.get("IDLE_TIMEOUT_SECONDS", "300"))
SPOTIFY_CLIENT_ID = os.environ["SPOTIFY_CLIENT_ID"]
SPOTIFY_CLIENT_SECRET = os.environ["SPOTIFY_CLIENT_SECRET"]
SPOTIFY_REFRESH_TOKEN = os.environ["SPOTIFY_REFRESH_TOKEN"]

GUILD = discord.Object(id=DISCORD_GUILD_ID)
SPOTIFY_URL_RE = re.compile(r"open\.spotify\.com/(track|album|playlist)/([A-Za-z0-9]+)")
DEFAULT_PLAYLIST_URL = "https://open.spotify.com/playlist/1WvjVLzdLWlte4L1zVrrtE?si=0bd01556bbc44bd2"

# How many resolved (playable) tracks to keep queued ahead of the current one.
# The rest of a playlist/album sits in `player.pending` as cheap metadata and
# only gets resolved to a YouTube track as it enters this window.
LOOKAHEAD = 5


@dataclass
class TrackMeta:
    title: str
    artist: str


class SpotifyClient:
    """Direct Spotify Web API access (Authorization Code flow).

    LavaSrc's Spotify integration only has a client-credentials app token,
    which Spotify no longer allows to read playlist/album track listings.
    A user-authorized token (this class) still can, and — unlike LavaSrc's
    unofficial partner-API workaround — doesn't need a slow per-track ISRC
    lookup to do it.
    """

    def __init__(self, session: aiohttp.ClientSession) -> None:
        self._session = session
        self._refresh_token = SPOTIFY_REFRESH_TOKEN
        self._access_token: str | None = None
        self._expires_at: float = 0.0

    async def _get_access_token(self) -> str:
        if self._access_token is None or time.monotonic() >= self._expires_at:
            auth = base64.b64encode(f"{SPOTIFY_CLIENT_ID}:{SPOTIFY_CLIENT_SECRET}".encode()).decode()
            async with self._session.post(
                "https://accounts.spotify.com/api/token",
                data={"grant_type": "refresh_token", "refresh_token": self._refresh_token},
                headers={"Authorization": f"Basic {auth}"},
            ) as resp:
                resp.raise_for_status()
                payload = await resp.json()
            self._access_token = payload["access_token"]
            self._expires_at = time.monotonic() + payload.get("expires_in", 3600) - 60
            if payload.get("refresh_token"):
                self._refresh_token = payload["refresh_token"]
        return self._access_token

    async def get_tracks(self, kind: str, spotify_id: str) -> tuple[str | None, list[TrackMeta]]:
        headers = {"Authorization": f"Bearer {await self._get_access_token()}"}

        if kind == "playlist":
            meta_url = f"https://api.spotify.com/v1/playlists/{spotify_id}"
            url: str | None = f"https://api.spotify.com/v1/playlists/{spotify_id}/tracks"
            params: dict[str, object] | None = {
                "fields": "items(track(name,artists(name))),next",
                "limit": 100,
            }
            item_key, track_key = "items", "track"
        else:
            meta_url = f"https://api.spotify.com/v1/albums/{spotify_id}"
            url = f"https://api.spotify.com/v1/albums/{spotify_id}/tracks"
            params = {"limit": 50}
            item_key, track_key = "items", None

        name = None
        async with self._session.get(meta_url, headers=headers, params={"fields": "name"}) as resp:
            if resp.status == 200:
                name = (await resp.json()).get("name")

        tracks: list[TrackMeta] = []
        while url:
            async with self._session.get(url, headers=headers, params=params) as resp:
                resp.raise_for_status()
                data = await resp.json()
            params = None  # `next` is a full URL with params already applied
            for item in data.get(item_key, []):
                track = item.get(track_key) if track_key else item
                if not track:
                    continue
                artists = track.get("artists") or []
                artist = artists[0]["name"] if artists else "Unknown"
                tracks.append(TrackMeta(title=track["name"], artist=artist))
            url = data.get("next")

        return name, tracks


class MusicBot(discord.Client):
    def __init__(self) -> None:
        super().__init__(intents=discord.Intents.default())
        self.tree = app_commands.CommandTree(self)

    async def setup_hook(self) -> None:
        self.http_session = aiohttp.ClientSession()
        self.spotify = SpotifyClient(self.http_session)

        node = wavelink.Node(uri=LAVALINK_URI, password=LAVALINK_PASSWORD)
        await wavelink.Pool.connect(nodes=[node], client=self)
        self.tree.copy_global_to(guild=GUILD)
        await self.tree.sync(guild=GUILD)

    async def close(self) -> None:
        await self.http_session.close()
        await super().close()

    async def on_ready(self) -> None:
        logging.info("Logged in as %s (%s)", self.user, self.user.id)

    async def on_wavelink_node_ready(self, payload: wavelink.NodeReadyEventPayload) -> None:
        logging.info("Lavalink node connected: %r (resumed=%s)", payload.node, payload.resumed)

    async def on_wavelink_track_start(self, payload: wavelink.TrackStartEventPayload) -> None:
        if payload.player is not None:
            await _fill_lookahead(payload.player)
            await _update_now_playing(payload.player)

    async def on_wavelink_track_end(self, payload: wavelink.TrackEndEventPayload) -> None:
        player = payload.player
        if player is not None and not player.playing and not player.queue and not getattr(player, "pending", None):
            await _clear_now_playing(player, "Queue finished.")

    async def on_wavelink_inactive_player(self, player: wavelink.Player) -> None:
        home = getattr(player, "home", None)
        if home is not None:
            await home.send(f"Leaving — inactive for {IDLE_TIMEOUT_SECONDS}s.")
        await _clear_now_playing(player, "Disconnected (inactive).")
        await _clear_controls(player, "Disconnected (inactive).")
        await player.disconnect()


bot = MusicBot()


async def _get_player(interaction: discord.Interaction, *, connect: bool = False) -> wavelink.Player | None:
    player = interaction.guild.voice_client  # type: ignore[union-attr]

    if player is None and connect:
        voice_state = interaction.user.voice  # type: ignore[union-attr]
        if voice_state is None or voice_state.channel is None:
            if interaction.response.is_done():
                await interaction.followup.send("Join a voice channel first.", ephemeral=True)
            else:
                await interaction.response.send_message("Join a voice channel first.", ephemeral=True)
            return None
        player = await voice_state.channel.connect(cls=wavelink.Player, self_deaf=True)
        player.inactive_timeout = IDLE_TIMEOUT_SECONDS
        player.home = interaction.channel
        player.pending = deque()
        player.now_playing_message = None
        # partial: advance through player.queue automatically, but never
        # append unsolicited "recommended" tracks when it empties (D4).
        player.autoplay = wavelink.AutoPlayMode.partial
        player.controls_message = await interaction.channel.send(  # type: ignore[union-attr]
            "🎛️ **Music Controls**", view=ControlsView(player)
        )

    return player  # type: ignore[return-value]


def _queue_text(player: wavelink.Player) -> str:
    lines: list[str] = []
    if player.current:
        lines.append(f"**Now playing:** {player.current.title} by `{player.current.author}`")

    upcoming = list(player.queue)[:10]
    if upcoming:
        lines.append("")
        lines.extend(f"{i + 1}. {t.title} — `{t.author}`" for i, t in enumerate(upcoming))

    pending = getattr(player, "pending", None)
    remaining = len(player.queue) - len(upcoming) + (len(pending) if pending else 0)
    if remaining > 0:
        lines.append(f"...and {remaining} more.")

    return "\n".join(lines) if lines else "Queue is empty."


async def _clear_controls(player: wavelink.Player, text: str) -> None:
    message: discord.Message | None = getattr(player, "controls_message", None)
    if message is None:
        return
    try:
        await message.edit(content=text, view=None)
    except discord.HTTPException:
        pass
    player.controls_message = None


class ControlsView(discord.ui.View):
    def __init__(self, player: wavelink.Player) -> None:
        super().__init__(timeout=None)
        self.player = player

    @discord.ui.button(emoji="📜", label="Queue", style=discord.ButtonStyle.secondary)
    async def queue_button(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        await interaction.response.send_message(_queue_text(self.player), ephemeral=True)

    @discord.ui.button(emoji="🚪", label="Leave", style=discord.ButtonStyle.danger)
    async def leave_button(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        await _clear_now_playing(self.player, "Disconnected.")
        await _clear_controls(self.player, "Disconnected.")
        await self.player.disconnect()
        await interaction.response.send_message("Disconnected.", ephemeral=True)


def _play_pause_label(player: wavelink.Player) -> tuple[str, str]:
    return ("▶️", "Resume") if player.paused else ("⏸️", "Pause")


class NowPlayingView(discord.ui.View):
    def __init__(self, player: wavelink.Player) -> None:
        super().__init__(timeout=None)
        self.player = player
        emoji, label = _play_pause_label(player)
        self.play_pause.emoji = emoji
        self.play_pause.label = label

    @discord.ui.button(style=discord.ButtonStyle.secondary, row=0)
    async def play_pause(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        await self.player.pause(not self.player.paused)
        await _update_now_playing(self.player, interaction=interaction)

    @discord.ui.button(emoji="⏮️", label="Previous", style=discord.ButtonStyle.secondary, row=0)
    async def previous(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        if await _play_previous(self.player):
            await interaction.response.defer()
        else:
            await interaction.response.send_message("No previous track.", ephemeral=True)

    @discord.ui.button(emoji="⏭️", label="Skip", style=discord.ButtonStyle.secondary, row=0)
    async def skip_button(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        if self.player.playing:
            await self.player.skip(force=True)
            await interaction.response.defer()
        else:
            await interaction.response.send_message("Nothing is playing.", ephemeral=True)

    @discord.ui.button(emoji="🔀", label="Shuffle", style=discord.ButtonStyle.secondary, row=0)
    async def shuffle_button(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        await _shuffle_all(self.player)
        await interaction.response.send_message("Shuffled.", ephemeral=True)


def _now_playing_embed(player: wavelink.Player) -> discord.Embed | None:
    track = player.current
    if track is None:
        return None
    status = "⏸️ Paused" if player.paused else "▶️ Playing"
    embed = discord.Embed(title=track.title, description=f"by `{track.author}`\n\n{status}")
    if track.artwork:
        embed.set_thumbnail(url=track.artwork)
    return embed


async def _update_now_playing(player: wavelink.Player, *, interaction: discord.Interaction | None = None) -> None:
    embed = _now_playing_embed(player)
    home = getattr(player, "home", None)
    message: discord.Message | None = getattr(player, "now_playing_message", None)

    if embed is None:
        if interaction is not None:
            await interaction.response.defer()
        return

    view = NowPlayingView(player)

    if interaction is not None:
        await interaction.response.edit_message(embed=embed, view=view)
        player.now_playing_message = interaction.message
        return

    if message is not None:
        try:
            await message.edit(embed=embed, view=view)
            return
        except discord.HTTPException:
            pass

    if home is not None:
        player.now_playing_message = await home.send(embed=embed, view=view)


async def _clear_now_playing(player: wavelink.Player, text: str) -> None:
    message: discord.Message | None = getattr(player, "now_playing_message", None)
    if message is None:
        return
    try:
        await message.edit(content=text, embed=None, view=None)
    except discord.HTTPException:
        pass
    player.now_playing_message = None


async def _play_previous(player: wavelink.Player) -> bool:
    history = player.queue.history
    if history is None or len(history) < 2:
        return False
    previous_track = history[-2]
    del history[-1]
    del history[-1]
    await player.play(previous_track)
    return True


async def _resolve_one(meta: TrackMeta) -> wavelink.Playable | None:
    try:
        results: wavelink.Search = await wavelink.Playable.search(f"ytsearch:{meta.title} {meta.artist}")
    except wavelink.LavalinkLoadException:
        return None
    if not results or isinstance(results, wavelink.Playlist):
        return None
    return results[0]


async def _fill_lookahead(player: wavelink.Player) -> None:
    pending: deque[TrackMeta] | None = getattr(player, "pending", None)
    if not pending:
        return
    while pending and len(player.queue) < LOOKAHEAD:
        track = await _resolve_one(pending.popleft())
        if track is not None:
            await player.queue.put_wait(track)


async def _shuffle_all(player: wavelink.Player) -> None:
    """Shuffle across the whole remaining tracklist, not just the resolved lookahead window."""
    pending: deque[TrackMeta] = getattr(player, "pending", None) or deque()
    combined = [TrackMeta(title=t.title, artist=t.author) for t in player.queue] + list(pending)
    random.shuffle(combined)

    player.queue.clear()
    pending.clear()
    pending.extend(combined)
    player.pending = pending

    await _fill_lookahead(player)


@bot.tree.command(description="Play a Spotify track, album, or playlist link. Defaults to Way Way Back")
@app_commands.describe(url="Spotify track, album, or playlist URL. Defaults to Way Way Back")
async def play(interaction: discord.Interaction, url: str | None = None) -> None:
    await interaction.response.defer()
    url = url or DEFAULT_PLAYLIST_URL

    player = await _get_player(interaction, connect=True)
    if player is None:
        return

    match = SPOTIFY_URL_RE.search(url)
    kind = match.group(1) if match else None

    if kind in ("playlist", "album"):
        spotify_id = match.group(2)
        try:
            name, tracks_meta = await bot.spotify.get_tracks(kind, spotify_id)
        except aiohttp.ClientError:
            await interaction.followup.send("Couldn't load that from Spotify. Try again in a moment.")
            return

        if not tracks_meta:
            await interaction.followup.send("That playlist/album looks empty (or isn't accessible).")
            return

        player.pending.extend(tracks_meta)
        await interaction.followup.send(f"Queued **{name or kind.capitalize()}** ({len(tracks_meta)} tracks).")

        await _fill_lookahead(player)
        if not player.playing and player.queue:
            await player.play(player.queue.get())
        return

    try:
        tracks: wavelink.Search = await wavelink.Playable.search(url)
    except wavelink.LavalinkLoadException:
        await interaction.followup.send("Couldn't load that link.")
        return

    if not tracks:
        await interaction.followup.send("Couldn't find anything for that link.")
        return

    if isinstance(tracks, wavelink.Playlist):
        added = await player.queue.put_wait(tracks)
        await interaction.followup.send(f"Queued **{tracks.name}** ({added} tracks).")
    else:
        track = tracks[0]
        await player.queue.put_wait(track)
        await interaction.followup.send(f"Queued **{track.title}** by `{track.author}`.")

    if not player.playing:
        await player.play(player.queue.get())


@bot.tree.command(description="Skip the current track")
async def skip(interaction: discord.Interaction) -> None:
    player = await _get_player(interaction)
    if player is None or not player.playing:
        await interaction.response.send_message("Nothing is playing.", ephemeral=True)
        return
    await player.skip(force=True)
    await interaction.response.send_message("Skipped.")


@bot.tree.command(description="Pause playback")
async def pause(interaction: discord.Interaction) -> None:
    player = await _get_player(interaction)
    if player is None or player.paused:
        await interaction.response.send_message("Already paused, or nothing is playing.", ephemeral=True)
        return
    await player.pause(True)
    await interaction.response.send_message("Paused.")
    await _update_now_playing(player)


@bot.tree.command(description="Resume playback")
async def resume(interaction: discord.Interaction) -> None:
    player = await _get_player(interaction)
    if player is None or not player.paused:
        await interaction.response.send_message("Not paused.", ephemeral=True)
        return
    await player.pause(False)
    await interaction.response.send_message("Resumed.")
    await _update_now_playing(player)


@bot.tree.command(description="Shuffle the current queue")
async def shuffle(interaction: discord.Interaction) -> None:
    player = await _get_player(interaction)
    if player is None or (not player.queue and not getattr(player, "pending", None)):
        await interaction.response.send_message("Queue is empty.", ephemeral=True)
        return
    await _shuffle_all(player)
    await interaction.response.send_message("Shuffled.")


@bot.tree.command(description="Show the current queue")
async def queue(interaction: discord.Interaction) -> None:
    player = await _get_player(interaction)
    if player is None:
        await interaction.response.send_message("Not connected to a voice channel.", ephemeral=True)
        return

    await interaction.response.send_message(_queue_text(player))


@bot.tree.command(description="Disconnect the bot from voice")
async def leave(interaction: discord.Interaction) -> None:
    player = await _get_player(interaction)
    if player is None:
        await interaction.response.send_message("Not connected to a voice channel.", ephemeral=True)
        return
    await _clear_now_playing(player, "Disconnected.")
    await _clear_controls(player, "Disconnected.")
    await player.disconnect()
    await interaction.response.send_message("Disconnected.")


def main() -> None:
    discord.utils.setup_logging(level=logging.INFO)
    bot.run(DISCORD_BOT_TOKEN)


if __name__ == "__main__":
    main()
