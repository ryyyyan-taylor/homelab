FROM node:22-alpine AS frontend
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM golang:1.23-alpine AS backend
WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
COPY --from=frontend /app/dist ./frontend/dist
RUN CGO_ENABLED=0 GOOS=linux go build -o /dash .

FROM alpine:3.21
RUN apk add --no-cache ca-certificates
COPY --from=backend /dash /dash
EXPOSE 8080
CMD ["/dash"]
