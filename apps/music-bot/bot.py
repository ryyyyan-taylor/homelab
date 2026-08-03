import logging
import os

import discord
import wavelink
from discord import app_commands

DISCORD_BOT_TOKEN = os.environ["DISCORD_BOT_TOKEN"]
DISCORD_GUILD_ID = int(os.environ["DISCORD_GUILD_ID"])
LAVALINK_URI = os.environ.get("LAVALINK_URI", "http://lavalink.music-bot.svc.cluster.local:2333")
LAVALINK_PASSWORD = os.environ["LAVALINK_PASSWORD"]
IDLE_TIMEOUT_SECONDS = int(os.environ.get("IDLE_TIMEOUT_SECONDS", "300"))

GUILD = discord.Object(id=DISCORD_GUILD_ID)


class MusicBot(discord.Client):
    def __init__(self) -> None:
        super().__init__(intents=discord.Intents.default())
        self.tree = app_commands.CommandTree(self)

    async def setup_hook(self) -> None:
        node = wavelink.Node(uri=LAVALINK_URI, password=LAVALINK_PASSWORD)
        await wavelink.Pool.connect(nodes=[node], client=self)
        self.tree.copy_global_to(guild=GUILD)
        await self.tree.sync(guild=GUILD)

    async def on_ready(self) -> None:
        logging.info("Logged in as %s (%s)", self.user, self.user.id)

    async def on_wavelink_node_ready(self, payload: wavelink.NodeReadyEventPayload) -> None:
        logging.info("Lavalink node connected: %r (resumed=%s)", payload.node, payload.resumed)

    async def on_wavelink_inactive_player(self, player: wavelink.Player) -> None:
        home = getattr(player, "home", None)
        if home is not None:
            await home.send(f"Leaving — inactive for {IDLE_TIMEOUT_SECONDS}s.")
        await player.disconnect()


bot = MusicBot()


async def _get_player(interaction: discord.Interaction, *, connect: bool = False) -> wavelink.Player | None:
    player = interaction.guild.voice_client  # type: ignore[union-attr]

    if player is None and connect:
        voice_state = interaction.user.voice  # type: ignore[union-attr]
        if voice_state is None or voice_state.channel is None:
            await interaction.response.send_message("Join a voice channel first.", ephemeral=True)
            return None
        player = await voice_state.channel.connect(cls=wavelink.Player)
        player.inactive_timeout = IDLE_TIMEOUT_SECONDS
        player.home = interaction.channel

    return player  # type: ignore[return-value]


@bot.tree.command(description="Play a Spotify track, album, or playlist link")
@app_commands.describe(url="Spotify track, album, or playlist URL")
async def play(interaction: discord.Interaction, url: str) -> None:
    await interaction.response.defer()

    player = await _get_player(interaction, connect=True)
    if player is None:
        return

    tracks: wavelink.Search = await wavelink.Playable.search(url)
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


@bot.tree.command(description="Resume playback")
async def resume(interaction: discord.Interaction) -> None:
    player = await _get_player(interaction)
    if player is None or not player.paused:
        await interaction.response.send_message("Not paused.", ephemeral=True)
        return
    await player.pause(False)
    await interaction.response.send_message("Resumed.")


@bot.tree.command(description="Show the current queue")
async def queue(interaction: discord.Interaction) -> None:
    player = await _get_player(interaction)
    if player is None:
        await interaction.response.send_message("Not connected to a voice channel.", ephemeral=True)
        return

    lines: list[str] = []
    if player.current:
        lines.append(f"**Now playing:** {player.current.title} by `{player.current.author}`")

    upcoming = list(player.queue)[:10]
    if upcoming:
        lines.append("")
        lines.extend(f"{i + 1}. {t.title} — `{t.author}`" for i, t in enumerate(upcoming))

    remaining = len(player.queue) - len(upcoming)
    if remaining > 0:
        lines.append(f"...and {remaining} more.")

    await interaction.response.send_message("\n".join(lines) if lines else "Queue is empty.")


@bot.tree.command(description="Disconnect the bot from voice")
async def leave(interaction: discord.Interaction) -> None:
    player = await _get_player(interaction)
    if player is None:
        await interaction.response.send_message("Not connected to a voice channel.", ephemeral=True)
        return
    await player.disconnect()
    await interaction.response.send_message("Disconnected.")


def main() -> None:
    discord.utils.setup_logging(level=logging.INFO)
    bot.run(DISCORD_BOT_TOKEN)


if __name__ == "__main__":
    main()
