"""Persistent knowledge tracing and race-event interpretation (offline)."""
from __future__ import annotations
import json

# P(learned), slip, guess, transition; illustrative defaults, calibrate on gameplay data.
INITIAL=.20
SLIP=.10
GUESS=.20
LEARN=.12

def bkt_update(prior:float,correct:bool)->float:
    prior=max(0.,min(1.,float(prior)))
    if correct:
        numerator=prior*(1-SLIP)
        denominator=numerator+(1-prior)*GUESS
    else:
        numerator=prior*SLIP
        denominator=numerator+(1-prior)*(1-GUESS)
    posterior=numerator/denominator if denominator else prior
    return round(posterior+(1-posterior)*LEARN,6)

RACE_EVENT_TOPICS={
    'no_go_zone':'курсы',
    'wrong_sail_trim':'оснастка',
    'failed_tack':'манёвры',
    'port_starboard_violation':'правила',
    'early_start':'старт',
    'gust_misjudgment':'ветер',
    'capsize_safety':'безопасность',
}

def apply_race_event(engine,player,event_type,details='',successful=False):
    if event_type not in RACE_EVENT_TOPICS:
        raise ValueError('Unknown race event')
    topic=RACE_EVENT_TOPICS[event_type]
    engine.record_event(player,topic,'race_success' if successful else 'race_error',
                        json.dumps({'event':event_type,'details':str(details)[:350]},ensure_ascii=False))
    return {'topic':topic,'mastery':engine.profile(player)[topic]['mastery'],
            'recommendation':engine.recommend(player)}
