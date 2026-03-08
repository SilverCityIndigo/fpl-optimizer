from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api import players, optimizer, gameweek

app = FastAPI(title="FPL Analyzer API", version="1.0.0")

from apscheduler.schedulers.background import BackgroundScheduler
from data.fpl_fetcher import sync_bootstrap

scheduler = BackgroundScheduler()
scheduler.add_job(sync_bootstrap, "interval", hours=2)  # adjust interval as needed
scheduler.start()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "https://fpl-optimizer-one.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(players.router, prefix="/api/players", tags=["players"])
app.include_router(optimizer.router, prefix="/api/optimizer", tags=["optimizer"])
app.include_router(gameweek.router, prefix="/api/gameweek", tags=["gameweek"])

@app.get("/")
def root():
    return {"status": "FPL Analyzer running"}