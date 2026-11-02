#!/bin/sh
# Deja Vu1: start the dashboard (or run: python3 start.py). It keeps running after this window closes.
cd "$(dirname "$0")" && exec python3 start.py
