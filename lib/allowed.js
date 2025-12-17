import fs from "fs-extra";

const FILE = "./allowed.json";

async function init() {
    if (!(await fs.pathExists(FILE))) {
        await fs.writeJSON(FILE, { users: [] }, { spaces: 2 });
    }
}

export async function addAllowed(num) {
    await init();
    const data = await fs.readJSON(FILE);
    if (!data.users.includes(num)) {
        data.users.push(num);
        await fs.writeJSON(FILE, data, { spaces: 2 });
    }
}

export async function removeAllowed(num) {
    await init();
    const data = await fs.readJSON(FILE);
    data.users = data.users.filter(n => n !== num);
    await fs.writeJSON(FILE, data, { spaces: 2 });
}

export async function isAllowed(num) {
    await init();
    const data = await fs.readJSON(FILE);
    return data.users.includes(num);
}
