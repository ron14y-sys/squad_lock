import path from "node:path";

// ESLint's flat config resolves ignores relative to the project root, so pass
// repo-relative paths rather than the absolute ones lint-staged hands over.
const eslintOnStagedFiles = (filenames) =>
  `eslint --fix --max-warnings=0 ${filenames
    .map((f) => `"${path.relative(process.cwd(), f)}"`)
    .join(" ")}`;

const config = {
  "*.{js,jsx,mjs,cjs,ts,tsx,mts}": [eslintOnStagedFiles, "prettier --write"],
  "*.{json,css,md,yml,yaml}": ["prettier --write"],
};

export default config;
