"""
run.py — Entry point for the Intelligent Parking System.

Windows + Python 3.12 fix: use WindowsSelectorEventLoopPolicy to avoid
ProactorEventLoop incompatibilities with uvicorn/asyncio.
"""
import asyncio
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
        log_level="info",
    )
