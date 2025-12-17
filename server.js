import express from "express";
import path from "path";
import cors from "cors";
import bodyParser from "body-parser";
import { fileURLToPath } from "url";

import qrRouter from "./qr.js";
import pairRouter from "./pair.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));

app.use("/qr", qrRouter);
app.use("/code", pairRouter);

app.get("/", (req, res) =>
    res.sendFile(path.join(__dirname, "index.html"))
);

app.listen(PORT, () => {
    console.log(`🚀 RAIZEL-XMD actif sur http://localhost:${PORT}`);
});
