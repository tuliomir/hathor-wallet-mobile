/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { tmpdir } = require('node:os');

/*
 * This file contains several steps necessary to maintain the translations in the project.
 * This update process consists of:
 * - Generating a `.pot` file with the strings obtained from all components in the `src` folder
 * - Creating `po` files for every existing language declared in the `existingTranslations` array
 * - Merging the `.pot` file with the existing translations in the `.po` files in `./locale`
 * - Warning the user if any manual intervention is needed (fuzzy tags)
 * - Generating a git-ignored JSON file containing all translations inside the `src/locale` folder
 *
 * The CI will run this script with the `--ci-validation` argument to check if the translations
 * were updated correctly. If there are any changes in the translation files or if there are any
 * fuzzy tags, the CI will fail. The steps executed for this validation are:
 * - Running all the translation steps as described above
 * - Checking if the `.pot` file is outdated
 * - Checking if all `.po` files have all messages from the `.pot` file
 * - Checking for any fuzzy tags in the `.po` files
 * - Checking for filesystem changes using `git status`
 * - Exiting with code 1 and failing if any of the above checks fail
 */

const existingTranslations = ['pt-br', 'da', 'ru-ru'];

/**
 * Runs the script to update the root `.pot` file with the new strings
 */
function runLocaleUpdatePot() {
  execSync('ttag extract -o ./locale/texts.pot ./src/', { stdio: 'inherit' });
}

/**
 * Checks whether the root `.pot` file is outdated.
 * @returns {boolean} True if the `.pot` file is outdated
 */
function checkPotOutdated() {
  let isPotOutdated = false;
  const myTmpDir = fs.mkdtempSync(path.join(tmpdir(), 'check_pot-'));
  try {
    // Extract the strings from the source code
    execSync(`npx ttag extract -o ${myTmpDir}/pot ./src/`, { stdio: 'inherit' });
    // Generate the `.po` files
    execSync(`msgen -o ${myTmpDir}/po ${myTmpDir}/pot`, { stdio: 'inherit' });
    // Check if the `.pot` file is outdated
    execSync(`msgcmp ${myTmpDir}/po ./locale/texts.pot`, { stdio: 'inherit' });
  } catch (error) {
    isPotOutdated = true;
    console.error('Error checking pot file:', error);
  } finally {
    fs.rmSync(myTmpDir, { recursive: true, force: true });
  }
  return isPotOutdated;
}

/**
 * Merges the `.pot` file with the translations in the `.po` files in each of the `locale` folders.
 * Creates subfolders and their translation files if they do not exist.
 */
function mergeTranslations() {
  const localeDir = 'locale';
  const potFile = path.join(localeDir, 'texts.pot');

  existingTranslations.forEach((subfolder) => {
    const subfolderPath = path.join(localeDir, subfolder);
    if (!fs.existsSync(subfolderPath)) {
      fs.mkdirSync(subfolderPath, { recursive: true });
    }
    const poFile = path.join(subfolderPath, 'texts.po');
    execSync(`msgmerge ${poFile} ${potFile} -o ${poFile}`, { stdio: 'inherit' });
  });
}

/**
 * Checks if all `.po` files have all messages from the `.pot` file.
 * Allows untranslated messages if `strict` is false.
 * @param {boolean} strict - If true, does not allow untranslated messages.
 * @returns {boolean} True if an error happened or if there are any differences
 */
function checkPoTranslations(strict = false) {
  const localeDir = 'locale';
  const potFile = path.join(localeDir, 'texts.pot');
  const subfolders = fs.readdirSync(localeDir)
    .filter((subfolder) => fs.statSync(path.join(localeDir, subfolder)).isDirectory());
  let errorHappened = false;

  subfolders.forEach((subfolder) => {
    const poFile = path.join(localeDir, subfolder, 'texts.po');
    const cmd = strict ? `msgcmp ${poFile} ${potFile}` : `msgcmp --use-untranslated ${poFile} ${potFile}`;
    try {
      // If there are any differences, the command will throw an error
      execSync(cmd, { stdio: 'inherit' });
    } catch (error) {
      console.error(`Error checking ${poFile}:`, error);
      errorHappened = true;
    }
  });

  return errorHappened
}

/**
 * Checks for any fuzzy tags in the `.po` files, as they indicate human review is necessary
 * @see https://www.gnu.org/software/gettext/manual/html_node/Fuzzy-Entries.html
 * @returns {boolean} True if any fuzzy tags were found
 */
function checkFuzzyTags() {
  const localeDir = 'locale';
  const subfolders = fs.readdirSync(localeDir)
    .filter((subfolder) => fs.statSync(path.join(localeDir, subfolder))
      .isDirectory());
  let containsFuzzy = false;

  subfolders.forEach((subfolder) => {
    const poFile = path.join(localeDir, subfolder, 'texts.po');
    const content = fs.readFileSync(poFile, 'utf-8');
    if (content.includes('fuzzy')) {
      containsFuzzy = true;
    }
  });

  if (containsFuzzy) {
    console.warn(`Warning: Fuzzy translations found in '.po' files. Please review the changes.`);
  }

  return containsFuzzy;
}

/**
 * Checks for filesystem changes using `git status`. If any changes are found, it means the
 * translation files have changed, and this may trigger a CI fail when running inside the CI.
 * @returns {boolean} True if changes were found, or if an error happened
 */
function checkForChanges() {
  try {
    const result = execSync('git status --porcelain', { encoding: 'utf-8' });
    return result.trim().length > 0;
  } catch (error) {
    console.error('Error checking for changes:', error);
    return true;
  }
}

try {
  const isCiValidationRun = process.argv.includes('--ci-validation');

  runLocaleUpdatePot();
  mergeTranslations();
  const hasFuzzyTags = checkFuzzyTags();
  const translationFilesChanged = checkForChanges();

  // If this script was called with the "--ci-validation" argument, it will fail if there are any
  // changes in the translation files or if there are any fuzzy tags
  if (isCiValidationRun) {
    const invalidPot = checkPotOutdated();
    const invalidPos = checkPoTranslations();
    if (invalidPot || invalidPos || hasFuzzyTags || translationFilesChanged) {
      process.exit(1);
    }
  }

  // Translations upgraded successfully
  process.exit(0);
} catch (error) {
  console.error('Error updating translations:', error);
  process.exit(1);
}
