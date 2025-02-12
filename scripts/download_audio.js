const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const crypto = require('crypto');

const MP3_API = "https://backendmix.vercel.app/mp3";
const DOWNLOAD_API = "https://backendmix-emergeny.vercel.app/d";
const CHANNEL_API = "https://backendmix.vercel.app/c";
const DOWNLOAD_DIR = path.join(__dirname, "..", "avas");
const DOWNLOADS_JSON = path.join(__dirname, "..", "downloads.json");
const MAX_RETRIES = 3;
const CHANNEL_ID = "UCVIq229U5A54UVzHQJqZCPQ";
const FILE_BASE_URL = "https://channel-khaki.vercel.app/avas/";
const RAPIDAPI_USERNAME = "BANK OF APIs";

const rapidApiMd5 = crypto.createHash('md5').update(RAPIDAPI_USERNAME).digest('hex');

if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

let downloadsData = {};
if (fs.existsSync(DOWNLOADS_JSON)) {
    try {
        downloadsData = JSON.parse(fs.readFileSync(DOWNLOADS_JSON, "utf-8"));
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

(async () => {
    try {
        console.log(`🔍 Fetching videos for channel ID: ${CHANNEL_ID}...`);
        const response = await axios.get(`${CHANNEL_API}/${CHANNEL_ID}`);

        if (!response.data || !response.data.videos || response.data.videos.length === 0) {
            console.error("❌ No videos found for this channel.");
            process.exit(1);
        }

        const videoIds = response.data.videos.map(video => video.id);
        console.log(`📹 Found ${videoIds.length} videos. Checking downloads...`);

        for (const videoId of videoIds) {
            const filename = `${videoId}.mp3`;
            const filePath = path.join(DOWNLOAD_DIR, filename);
            const fileUrl = `${FILE_BASE_URL}${filename}`;

            if (downloadsData[videoId] && fs.existsSync(filePath) && downloadsData[videoId].size > 0) {
                console.log(`⏭️ Skipping ${videoId}, already downloaded.`);
                continue;
            }

            console.log(`🎵 Downloading ${videoId}...`);

            let success = false;
            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                try {
                    console.log(`🔄 Attempt ${attempt}/${MAX_RETRIES}...`);

                    const downloadInfo = await axios.get(`${DOWNLOAD_API}/${videoId}`);
                    const { link: url, title: videoTitle, filesize } = downloadInfo.data;

                    if (!url) {
                        throw new Error("No download URL available");
                    }

                    const title = videoTitle ? videoTitle.trim() : `Video ${videoId}`;
                    const writer = fs.createWriteStream(filePath);
                    const audioResponse = await axios({
                        url,
                        method: "GET",
                        responseType: "stream",
                        timeout: 30000,
                        headers: {
                            'User-Agent': `Mozilla/5.0 ${RAPIDAPI_USERNAME}`,
                            'X-RUN': rapidApiMd5
                        }
                    });

                    audioResponse.data.pipe(writer);

                    await new Promise((resolve, reject) => {
                        writer.on("finish", resolve);
                        writer.on("error", reject);
                    });

                    const downloadedSize = fs.statSync(filePath).size;
                    if (downloadedSize === 0 || (filesize && downloadedSize < filesize * 0.9)) {
                        throw new Error("Downloaded file size is incorrect or zero");
                    }

                    console.log(`✅ Download successful: ${filePath} (${(downloadedSize / 1024 / 1024).toFixed(2)} MB)`);
                    console.log(`📝 Title: ${title}`);

                    downloadsData[videoId] = {
                        title: title,
                        id: videoId,
                        filePath: fileUrl,
                        size: downloadedSize
                    };

                    fs.writeFileSync(DOWNLOADS_JSON, JSON.stringify(downloadsData, null, 2));
                    commitFile(filePath, videoId, title);
                    success = true;
                    break;
                } catch (err) {
                    console.error(`⚠️ Download failed for ${videoId}: ${err.message}`);
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                    if (attempt === MAX_RETRIES) {
                        console.error(`❌ Failed after ${MAX_RETRIES} attempts. Skipping ${videoId}.`);
                    }
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }

            if (!success) {
                console.error(`🚨 Download permanently failed for: ${videoId}`);
            }
        }
    } catch (error) {
        console.error("❌ Error fetching channel videos:", error.message);
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
