import fs from "fs-extra";
const FILE = "./allowed.json";

export async function addAllowed(number) {
    const data = await fs.readJSON(FILE).catch(() => ({ owners: [] }));
    if (!data.owners.includes(number)) {
        data.owners.push(number);
        await fs.writeJSON(FILE, data, { spaces: 2 });
        console.log("✅ Autorisé :", number);
    }
}

export async function removeAllowed(number) {
    const data = await fs.readJSON(FILE).catch(() => ({ owners: [] }));
    data.owners = data.owners.filter(n => n !== number);
    await fs.writeJSON(FILE, data, { spaces: 2 });
    console.log("❌ Retiré :", number);
}

export async function isAllowed(jid, botNumber) {
    const user = jid.split("@")[0];
    const data = await fs.readJSON(FILE).catch(() => ({ owners: [] }));
    return user === botNumber || data.owners.includes(user);
}
