export const getEnv = (name: string): string => {
    const env = process.env[name];
    if (env == null) {
        throw new Error("missing environmental variable: " + name);
    }
    return env;
};
