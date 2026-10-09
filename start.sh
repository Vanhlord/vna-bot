#!/usr/bin/env bash

echo "==================================================="
echo "       STARTING VNA MUSIC BOT (COMMERCIAL)"
echo "==================================================="

if [ ! -d "node_modules" ]; then
    echo "[INFO] Installing dependencies..."
    npm install
fi

if [ ! -f ".env" ]; then
    echo "[WARNING] .env not found. Creating from .env.example..."
    cp .env.example .env
    echo "[ACTION REQUIRED] Please edit .env and fill in your DISCORD_TOKEN."
    exit 1
fi

npm start
