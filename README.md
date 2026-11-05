### BeautyMatch

Personalized Skincare Recommendation for Frappe CRM

Frontend preview and API integration: [BeautyMatch frontend handoff](docs/FRONTEND_HANDOFF.md).

Giao diện CRM dùng chung Botanical Cinema: [tích hợp CRM thật, hướng dẫn build, kiểm thử và rollback](docs/CRM_VISUAL_INTEGRATION.md).

Ứng dụng CRM hoàn chỉnh chạy tại `http://localhost:8000/beautymatch` trên site Frappe hiện có.
Xem [báo cáo bàn giao tiếng Việt và hướng dẫn demo](docs/BAO_CAO_HOAN_THIEN.md).

Giao diện mới: [BeautyMatch — Botanical Cinema, hình ảnh và kết quả kiểm thử](docs/BOTANICAL_CINEMA.md).

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
