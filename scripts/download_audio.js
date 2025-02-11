const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const crypto = require('crypto');

const DOWNLOAD_API = "https://backendmix-emergeny.vercel.app/d";
const CHANNEL_API = "https://backendmix-emergeny.vercel.app/list";
const DOWNLOAD_DIR = path.join(__dirname, "..", "avas");
const DOWNLOADS_JSON = path.join(__dirname, "..", "downloads.json");
const MAX_RETRIES = 3;
const CHANNEL_ID = "UCVIq229U5A54UVzHQJqZCPQ";
const FILE_BASE_URL = "https://channel-khaki.vercel.app/avas/";
const RAPIDAPI_USERNAME = "BANK OF APIs";

// Generate MD5 hash of RapidAPI username
const USERNAME_HASH = crypto.createHash('md5').update(RAPIDAPI_USERNAME).digest('hex');

// Ensure the download directory exists
if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

// Load existing downloads data
let downloadsData = {};
if (fs.existsSync(DOWNLOADS_JSON)) {
    try {
        downloadsData = JSON.parse(fs.readFileSync(DOWNLOADS_JSON, "utf-8"));
        // Update old file paths
        for (const videoId in downloadsData) {
            if (!downloadsData[videoId].filePath.startsWith(FILE_BASE_URL)) {
                downloadsData[videoId].filePath = `${FILE_BASE_URL}${videoId}.mp3`;
            }
        }
        fs.writeFileSync(DOWNLOADS_JSON, JSON.stringify(downloadsData, null, 2));
    } catch (err) {
        console.error("❌ Failed to load downloads.json, resetting file.");
        downloadsData = {};
    }
}

const downloadFile = async (url, filePath) => {
    const writer = fs.createWriteStream(filePath);
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
        timeout: 30000,
        headers: {
            'User-Agent': `Mozilla/5.0 ${RAPIDAPI_USERNAME}`,
            'X-RUN': USERNAME_HASH
        }
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
};

(async () => {
    try {
        console.log(`🔍 Fetching videos for channel ID: ${CHANNEL_ID}...`);
        const response = await axios.get(`${CHANNEL_API}/${CHANNEL_ID}`);

        if (!response.data || !response.data.videos || response.data.videos.length === 0) {
            console.error("❌ No videos found for this channel.");
            process.exit(1);
        }

        const videoIds = response.data.videos;
        console.log(`📹 Found ${videoIds.length} videos to process`);

        for (const videoId of videoIds) {
            const filename = `${videoId}.mp3`;
            const filePath = path.join(DOWNLOAD_DIR, filename);
            const fileUrl = `${FILE_BASE_URL}${filename}`;

            // Skip if already downloaded and valid
            if (downloadsData[videoId] && fs.existsSync(filePath) && downloadsData[videoId].size > 0) {
                console.log(`⏭️ Skipping ${videoId}, already downloaded`);
                continue;
            }

            console.log(`🎵 Processing download for ${videoId}...`);

            let success = false;
            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                try {
                    console.log(`🔄 Attempt ${attempt}/${MAX_RETRIES}...`);

                    // Get download information from new API
                    const downloadResponse = await axios.get(`${DOWNLOAD_API}/${videoId}`);
                    const { link, title, filesize, status } = downloadResponse.data;

                    if (status !== "ok" || !link) {
                        throw new Error("Invalid download response");
                    }

                    // Download the file with secure headers
                    await downloadFile(link, filePath);

                    // Verify file size
                    const actualFileSize = fs.statSync(filePath).size;
                    if (actualFileSize === 0) {
                        throw new Error("Downloaded file size is 0 bytes");
                    }

                    console.log(`✅ Download completed: ${filePath} (${(actualFileSize / 1024 / 1024).toFixed(2)} MB)`);
                    console.log(`📝 Title: ${title}`);

                    // Save to downloads.json
                    downloadsData[videoId] = {
                        title: title,
                        id: videoId,
                        filePath: fileUrl,
                        size: actualFileSize
                    };

                    fs.writeFileSync(DOWNLOADS_JSON, JSON.stringify(downloadsData, null, 2));

                    // Commit the file
                    commitFile(filePath, videoId, title);
                    success = true;
                    break;
                } catch (err) {
                    console.error(`⚠️ Error downloading ${videoId}: ${err.message}`);
                    if (attempt === MAX_RETRIES) {
                        console.error(`❌ Failed after ${MAX_RETRIES} attempts, skipping.`);
                    }
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }

            if (!success) {
                console.error(`🚨 Skipped: ${videoId} due to repeated errors.`);
            }
        }
    } catch (error) {
        console.error("❌ Error:", error.message);
    }
})();

function commitFile(filePath, videoId, title) {
    try {
        execSync("git config --global user.name 'github-actions'");
        execSync("git config --global user.email 'github-actions@github.com'");
        execSync(`git add "${filePath}" "${DOWNLOADS_JSON}"`);
        execSync(`git commit -m "Add downloaded audio: ${title} (${videoId})"`);
        execSync("git push");
        console.log(`📤 Committed and pushed ${filePath}`);
    } catch (err) {
        console.error("❌ Error committing file:", err.message);
    }
}
