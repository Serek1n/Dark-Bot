const path = require('path');
const fs = require('fs');
const { Sequelize } = require('sequelize');
require('dotenv').config();

const dbPath = process.env.DATABASE_PATH || './data/dark.sqlite';
const absPath = path.resolve(process.cwd(), dbPath);
fs.mkdirSync(path.dirname(absPath), { recursive: true });

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: absPath,
  logging: false
});

const modelsDir = path.join(__dirname, 'models');
const models = {};

fs.readdirSync(modelsDir)
  .filter((f) => f.endsWith('.js'))
  .forEach((file) => {
    const define = require(path.join(modelsDir, file));
    const model = define(sequelize);
    models[model.name] = model;
  });

Object.values(models).forEach((model) => {
  if (typeof model.associate === 'function') model.associate(models);
});

async function init() {
  await sequelize.sync(); // creates tables if they don't exist
}

module.exports = { sequelize, init, ...models };
