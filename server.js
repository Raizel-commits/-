import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { exec } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.use(express.static(__dirname));

const upload = multer({ dest: 'uploads/' });

app.post('/upload', upload.single('file'), async (req, res) => {
    const file = req.file;
    const ext = path.extname(file.originalname).toLowerCase();
    let outputFile = '';

    try {
        if(['.mp4','.webm'].includes(ext)) {
            outputFile = `uploads/${file.filename}.mp3`;
            await execPromise(`ffmpeg -i "${file.path}" -q:a 0 -map a "${outputFile}"`);
        } else if(['.mp3','.wav','.ogg'].includes(ext)) {
            const imgPath = 'placeholder.jpg'; 
            outputFile = `uploads/${file.filename}.mp4`;
            await execPromise(`ffmpeg -loop 1 -i "${imgPath}" -i "${file.path}" -c:v libx264 -c:a aac -b:a 192k -shortest "${outputFile}"`);
        } else {
            outputFile = `uploads/${file.filename}${ext}`;
            fs.renameSync(file.path, outputFile);
        }

        const url = `${req.protocol}://${req.get('host')}/${outputFile}`;
        res.json({ url });
    } catch (e) {
        console.error(e);
        res.status(500).send("Erreur lors de la conversion");
    }
});

function execPromise(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, (err, stdout, stderr) => err ? reject(err) : resolve(stdout));
    });
}

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

app.listen(3000, () => console.log("Serveur sur http://localhost:3000"));
