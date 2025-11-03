const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const puppeteer = require('puppeteer');
const fs = require('fs/promises');
const ejs = require('ejs');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const { v4: uuidv4 } = require('uuid');
const { marked } = require('marked');
const { MongoClient, ServerApiVersion } = require('mongodb');

dotenv.config();

const app = express();

let browser;
let mongoClient;

const PORT = process.env.PORT || 5000;
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const uri = process.env.MONGODB_URI;

async function connectToMongo() {
    try {
        const client = new MongoClient(uri, {
            serverApi: {
                version: ServerApiVersion.v1,
                strict: true,
                deprecationErrors: true,
            }
        });
        await client.connect();
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
        return client;
    } catch (error) {
        console.error("MongoDB connection error:", error);
        process.exit(1);
    }
}

const modelConfig = {
    model: 'gemini-2.5-flash',
};

const safetySettings = [
    {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
    },
];

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, '../FRONTEND')));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'view'));

const getResponseText = (response) => {
    try {
        return response?.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } catch (error) {
        console.error('Error parsing AI response:', error);
        return '';
    }
};
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.post('/ask', async (req, res) => {
    const { name, email, phone, linkedin, college, degree, year, skills, projects, achievements, experience, company } = req.body;

    if (!name || !email || !skills) {
        return res.status(400).send('Missing required fields: name, email, skills.');
    }

    try {
        if (mongoClient) {
            const db = mongoClient.db("USERS");
            const collection = db.collection("USERS");

            const resumeEntry = {
                name,
                email,
                phone,
                linkedin,
                college,
                degree,
                year,
                skills,
                projects,
                achievements,
                experience,
                company,
                createdAt: new Date()
            };

            await collection.insertOne(resumeEntry);
            console.log(`User data for ${name} saved to MongoDB.`);
        } else {
            console.warn("MongoDB client not initialized. User data was NOT saved to DB.");
        }

        const model = genAI.getGenerativeModel(modelConfig, { safetySettings });

        const prompts = {
            skills: `As a professional resume writing expert, your task is to enhance the provided skills for a software engineer's resume, specifically targeting a position at "${company || 'a company'}".
If the provided skills are  appear to be "gibberish," infer and list relevant and impactful technical and soft skills for a software engineer (e.g., Programming Languages, Frameworks, Tools, Databases, Cloud Platforms).
Format the output as a concise, professional, **comma-separated list of 5-10 key skills**. If skills are provided then doont extra skill from ur side.
**Strictly avoid bullet points, paragraphs, conversational text, or any preamble/postamble.** Provide only the comma-separated list. Keep the total output for skills under 50 words.

Skills to enhance: ${skills}`,

            experience: `As a professional resume writing expert, rewrite the following work experience for a software engineer's resume, targeting a position at "${company || 'a company'}".
Focus solely on achievements, quantifiable results, and responsibilities using strong action verbs.
If no experience is provided return "NA" ONLY.
**Format each experience entry using Markdown bullet points (e.g., '* Achieved X by doing Y').** Ensure each bullet point is concise (1-2 lines) and professional.
**Do not use paragraphs, conversational text, or any preamble/postamble.**
Keep the total output for experience concise, ideally under 100 words.

Experience to rewrite: ${experience}`,

            projects: `As a professional resume writing expert, enhance the descriptions of the following software engineering projects for a resume, targeting a position at "${company || 'a company'}".
For each project:
- Highlight technologies used (e.g., Python, React, AWS, SQL).
- Emphasize outcomes, impact, or features developed.
- Quantify results where possible.
If the provided project details are "gibberish", infer and create 2-3 realistic and impactful software engineering project descriptions for a software engineer. Fill in any missing details like technologies or outcomes to make them professional and complete.
if projects are provided then dont add extra projects from ur side.
**Format each project as a concise Markdown bullet point, starting with the project name (e.g., '* Project Name: Description...').** Each bullet point should be professional and not a paragraph.
**Your output will be used directly in the resume. Do not use paragraphs, conversational text, or any preamble/postamble.**
Keep the total output for projects concise, ideally under 100 words.

Projects to enhance: ${projects}`,

            achievements: `As a professional resume writing expert, rewrite the following achievements, targeting a position at "${company || 'a company'}".
Focus solely on impact, recognition, and specific contributions. Quantify results whenever possible.
If no achievements are provided, return "NA" ONLY.
Fill in any missing details to make them professional.
**Format each achievement as a concise, professional Markdown bullet point.**
**Your output will be used directly in the resume. Do not use paragraphs, conversational text, or any preamble/postamble.**
Keep the total output for achievements concise, ideally under 100 words.

Achievements to rewrite: ${achievements}`,
        };

        const [skillsRes, experienceRes, projectRes, achievementRes] = await Promise.all([
            model.generateContent(prompts.skills),
            model.generateContent(prompts.experience),
            model.generateContent(prompts.projects),
            model.generateContent(prompts.achievements),
        ]);

        const rawSkills = getResponseText(skillsRes);
        const rawExperience = getResponseText(experienceRes);
        const rawProjects = getResponseText(projectRes);
        const rawAchievements = getResponseText(achievementRes);

        const formattedExperience = (rawExperience && rawExperience.trim().toUpperCase() !== 'NA' && rawExperience.trim() !== '') ? marked.parse(rawExperience) : 'NA';
        const formattedProjects = (rawProjects && rawProjects.trim().toUpperCase() !== 'NA' && rawProjects.trim() !== '') ? marked.parse(rawProjects) : 'NA';
        const formattedAchievements = (rawAchievements && rawAchievements.trim().toUpperCase() !== 'NA' && rawAchievements.trim() !== '') ? marked.parse(rawAchievements) : 'NA';
        const html = await ejs.renderFile(path.join(__dirname, 'view', 'template.ejs'), {
            name,
            email,
            phone,
            linkedin,
            college,
            degree,
            year,
            skills: rawSkills,
            projects: formattedProjects,
            achievements: formattedAchievements,
            experience: formattedExperience,
        });

        const pdfFilename = `resume-${uuidv4()}.pdf`;
        const pdfPath = path.join(__dirname, pdfFilename);
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        await page.pdf({ path: pdfPath, format: 'A4', printBackground: true });
        await page.close();

        res.download(pdfPath, 'resume.pdf', async (err) => {
            if (err) {
                console.error('Download error:', err);
                if (!res.headersSent) {
                    res.status(500).send('Error downloading file');
                }
            }
            try {
                await fs.unlink(pdfPath);
            } catch (cleanupErr) {
                console.error('File cleanup error:', cleanupErr);
            }
        });

    } catch (error) {
        console.error('Resume generation or database save error:', error);
        if (!res.headersSent) {
            res.status(500).send('Resume generation failed');
        }
    }
});

const startServer = async () => {
    try {
        console.log('Launching Puppeteer browser...');
        mongoClient = await connectToMongo();
        console.log('MongoDB connected successfully.');
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        console.log('Browser launched successfully.');

        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();

const cleanup = async () => {
    console.log('Closing browser...');
    if (browser) {
        await browser.close();
    }
    if (mongoClient) {
        console.log('Closing MongoDB client...');
        await mongoClient.close();
    }
    process.exit();
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    cleanup();
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    cleanup();
});

