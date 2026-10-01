FROM python:3.13-slim
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py ./
# spotdl needs a writable $HOME for its config/cache dir (~/.spotdl);
# `nobody`'s default home isn't writable, so point it at /tmp, which is
# already this service's scratch space.
ENV HOME=/tmp
USER nobody
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
