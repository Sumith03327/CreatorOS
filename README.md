# Creator Hub - YouTube Growth SaaS (Standalone)

This project is a standalone YouTube content strategy dashboard optimized for local development.

## 🚀 Fix for Large File Error (GitHub 100MB Limit)

If you see an error about `creator-hub.zip` being too large, run these commands in your terminal to fix it:

```bash
# 1. Remove the zip file from your computer
rm creator-hub.zip

# 2. Remove the zip file from Git's memory
git rm --cached creator-hub.zip

# 3. Fix your last commit
git commit --amend -m "Initial commit - removed large zip"

# 4. Push to your repository
git push -u origin main --force
```

## Local Setup
1. Clone this repository or download the files.
2. Run `npm install` to install dependencies.
3. Configure your `.env` file with your API keys (YouTube & DeepSeek).
4. Run `npm run dev` to start the development server.

## GitHub Setup (LFS Enabled)
```bash
git init
git lfs install
git add .gitattributes
git remote add origin https://github.com/Sumith03327/lunixity.git
git add .
git commit -m "Standalone Creator Hub with LFS"
git branch -M main
git push -u origin main --force
```
