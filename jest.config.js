try {
  process.loadEnvFile(".env.test");
} catch (e) {
  console.log("error loading .env.test");
}

/** @type {import("jest").Config} **/
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
};
