# node-skeleton-app

Express 5 + Dotenv + CORS app, scaffolded by [4bnode](https://github.com/pawan-4brains/4bnode).

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Edit `.env` in the project root and fill in the values your app needs:

```bash
PORT=3000
# Add DATABASE_URL, API keys, etc. here
```

### 3. Run it

```bash
npm run dev
```

The app starts at `http://localhost:PORT` and the dev dashboard at `http://localhost:PORT/_dev`.

## Project structure

```
.
├── index.js              # Express app entry point
├── package.json
├── .env                  # Environment variables
├── .4bnode/              # Dashboard engine & data (managed by 4bnode)
├── public/               # Static files
└── src/
    ├── db.js             # MongoDB connection (after `4bnode add mongo`)
    ├── models/           # Mongoose schemas
    └── routes/           # API route files
```

## Extending with 4bnode

Run `4bnode add` inside this project to scaffold MongoDB, CRUD, login, sockets, and more. See the [4bnode README](https://github.com/pawan-4brains/4bnode) for the full feature list.
