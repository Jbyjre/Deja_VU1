#!/bin/sh
# Deja Vu1: double-click to start the dashboard. It keeps running after this window closes.
cd "$(dirname "$0")" && exec python3 start.py
