# Sentry Loop demo video runbook

## Run a dependable local recording

This checkout lives outside iCloud Drive so macOS does not offload the Python entry files or dependencies. From the repository root:

```bash
scripts/start_demo.sh
```

Open `http://127.0.0.1:7860/`. The launcher installs the locked Python 3.12 environment if needed, starts the Arena with local simulated data, and asks for no cloud credentials. Stop it with Ctrl-C after recording. If port 7860 is occupied, use `PORT=7861 scripts/start_demo.sh` and open port 7861 instead.

## Record the comparison

1. Open **Arena**. Open **Episode settings**, set the seed to **555**, keep **Baseline**, and click **Run new episode**. Pause the replay and move the action slider near action 20 to show tick 06.
2. Open **Compare**. Select **Mixed multi-system** (seed 555), then click **Run comparison**. The paired replay opens at ticks 04–09.
3. At tick 06, show the baseline `issue_refund` attempt. The simulated billing system reports that $500 exceeds the attack-modified $100 limit and rejects it. Show the resilient `get_current_policy` action at the same tick.
4. If time permits, show **Training → Reward**. Label it as the included historical 216-step Worker recording.

The two compared policies are heuristic demonstrations. Seed 555 shows Worker scores of 17 and 26, respectively, in this simulation. The failed refund attempt is evidence of a policy violation caught by the simulated billing system; it is not a money transfer. Avoid describing the 10% attack success rate in Analytics as confirmed money loss because that metric is a reward proxy.

## Put the app on Render

This branch includes `render.yaml` for a free Docker web service. Open the [Render setup link](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2FSanjayMarathe%2Fsentry-loop%2Ftree%2Fdemo-render) while signed in to Render. A Render account created with an email address can use the public repository URL. Review the one service named `sentry-loop-demo`, the **Free** plan, and the environment values, then deploy it. Render serves the app at its `onrender.com` address after the build completes.

The public app runs the same credential-free episodes and comparisons. Public mode protects owner-only endpoints; it returns HTTP 401 when no control token is configured. Render's free service sleeps after 15 minutes without requests, so open the public URL before sharing it and use the local copy while recording. The free service's temporary files can disappear on restart; checked-in simulation code and historical charts remain available.

The older Hugging Face static portal embeds an expired Tenki preview. Share the verified Render address for the working app.
