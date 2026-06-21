/* Script overview:
 * Builds one configured script set for every CommonJS file in config/.
 * Replaces marked string values by matching their CONFIG property names.
 * Writes complete, ready-to-copy scripts below built/<config-name>/.
 */
const fs = require('fs');
const path = require('path');

const scriptsDir = path.join(__dirname, 'scripts');
const configDir = path.join(__dirname, 'config');
const builtDir = path.join(__dirname, 'built');

const scriptFiles = fs.readdirSync(scriptsDir)
    .filter(file => file.endsWith('.js'));

const configFiles = fs.readdirSync(configDir)
    .filter(file => file.endsWith('.cjs'));

for (const configFile of configFiles) {
    const config = require(path.join(configDir, configFile));
    const outputDir = path.join(builtDir, path.basename(configFile, '.cjs'));

    fs.rmSync(outputDir, { recursive: true, force: true });
    fs.mkdirSync(outputDir, { recursive: true });

    for (const scriptFile of scriptFiles) {
        const source = fs.readFileSync(path.join(scriptsDir, scriptFile), 'utf8');
        const built = source.replace(
            /\/\/ BUILD-CONFIG-START[\s\S]*?\/\/ BUILD-CONFIG-END/g,
            block => block.replace(
                /^([ \t]*)([$A-Z_a-z][$\w]*)([ \t]*:[ \t]*)(?:'[^'\r\n]*'|"[^"\r\n]*"|`[^`\r\n]*`)([ \t]*,?)([^\r\n]*)$/gm,
                (line, indent, key, separator, comma, comment) => {
                    if (config[key] === undefined) {
                        throw new Error(`${configFile}: missing ${key}`);
                    }

                    return `${indent}${key}${separator}${JSON.stringify(config[key])}${comma}${comment}`;
                }
            )
        );

        fs.writeFileSync(path.join(outputDir, scriptFile), built);
    }
}
