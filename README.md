### BeautyMatch

Personalized Skincare Recommendation for Frappe CRM

Frontend preview and API integration: [BeautyMatch frontend handoff](docs/FRONTEND_HANDOFF.md).

```bash
npm ci
npm run dev
```

Open `http://127.0.0.1:4173/beautymatch/result?demo=1` or `/beautymatch/dashboard?demo=1`.
The local preview uses explicitly labeled demo data; live CRM requires the Frappe site.

### Installation

You can install this app using the [bench](https://github.com/frappe/bench) CLI:

```bash
cd $PATH_TO_YOUR_BENCH
bench get-app $URL_OF_THIS_REPO --branch develop
bench install-app beautymatch
```

### Contributing

This app uses `pre-commit` for code formatting and linting. Please [install pre-commit](https://pre-commit.com/#installation) and enable it for this repository:

```bash
cd apps/beautymatch
pre-commit install
```

Pre-commit is configured to use the following tools for checking and formatting your code:

- ruff
- eslint
- prettier
- pyupgrade

### License

mit
