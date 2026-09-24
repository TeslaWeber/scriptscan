# Script Scan & Export

Build a web application that enables university staff to digitize and compile students’ marked exam scripts into structured Microsoft Excel outputs. The system should allow a user, upon opening the site, to upload images of marked scripts directly from their device gallery or camera. Once uploaded, the application must apply robust OCR and image-processing techniques to automatically detect and extract two key data points from each script: the student’s matriculation number and the lecturer-awarded score written in the format “score/total score” (typically circled or highlighted on the script). The extraction logic should be resilient to variations in handwriting, ink color, orientation, and image quality, and should include preprocessing steps such as cropping, denoising, contrast enhancement, and region detection to isolate relevant areas of the script. The system should validate extracted matric numbers against a configurable pattern and normalize scores into a consistent numeric format. All processed records belonging to the same course should be aggregated in-session and persistable, with the ability to review, edit, or correct entries before export. Finally, the application should generate and allow download of a Microsoft Excel (.xlsx) file containing a clean tabular dataset with columns labeled “MATRIC NO.” and “SCORE”, ensuring compatibility with standard spreadsheet tools, proper data typing, and no duplication of records. Include a simple, mobile-friendly UI, progress indicators during scanning, and error handling for unreadable scripts or missing data.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://scriptscan.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/2e94216a-430d-4d2c-a4b4-e53c1e1f4c56).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
