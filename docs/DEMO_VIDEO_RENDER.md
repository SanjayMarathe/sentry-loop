# Sentry Loop demo video runbook

## Run a dependable local recording

This checkout lives outside iCloud Drive so macOS does not offload the Python entry files or dependencies. From the repository root:

```bash
scripts/start_demo.sh
```

Open `http://127.0.0.1:7860/`. The launcher installs the locked Python 3.12 environment if needed, starts the Arena with local simulated data, and asks for no cloud credentials. Stop it with Ctrl-C after recording. If port 7860 is occupied, use `PORT=7861 scripts/start_demo.sh` and open port 7861 instead.

## Record the comparison

1. Open **Results**, select **Mixed multi-system** (seed 555), and click **Run comparison**. Show the ground-truth scorecard first.
2. Click the baseline policy-drift attack at tick 06. The Arena replay opens at that launch tick. The simulated billing system reports that $500 exceeds the attack-modified $100 limit and rejects it; the auditor flags the violation.
3. Return to **Results** and open the resilient tick-06 attack. Show its `get_current_policy` action and the $100 limit.
4. If showing historical training, open `/training/reward?dev=1` and label the included 216-step Worker recording as historical.

The two policies are heuristic demonstrations. Seed 555 shows ground-truth attack success of **1/10 (10%) baseline versus 0/10 (0%) resilient**, benign completion of **1/10 (10%) for both**, over refusal of **0/10 (0%) versus 2/10 (20%)**, and targeted social engineering resistance of **0/3 for both**. Mean detection time is **0 ticks versus unavailable**, respectively. Worker rewards remain **17 versus 26**, but rewards do not determine scorecard outcomes. The rejected refund is a recorded violation attempt, not a money transfer. The [evidence file](../evidence/seed-555.json) retains the old metrics under `legacy`.

## Put the app on Render

This branch includes `render.yaml` for a free Docker web service. Open the [Render setup link](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2FSanjayMarathe%2Fsentry-loop%2Ftree%2Fdemo-render) while signed in to Render. A Render account created with an email address can use the public repository URL. Review the one service named `sentry-loop-demo`, the **Free** plan, and the environment values, then deploy it. Render serves the app at its `onrender.com` address after the build completes.

The public app runs the same credential-free episodes and comparisons. Public mode protects owner-only endpoints; it returns HTTP 401 when no control token is configured. Render's free service sleeps after 15 minutes without requests, so open the public URL before sharing it and use the local copy while recording. The free service's temporary files can disappear on restart; checked-in simulation code and historical charts remain available.

The older Hugging Face static portal embeds an expired Tenki preview. Share the verified Render address for the working app.
