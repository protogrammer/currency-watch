try {
  process.loadEnvFile(".env.test");
} catch (e) {
  console.warn("error loading .env.test:", e);
}

/** @type {import("jest").Config} **/
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
};
