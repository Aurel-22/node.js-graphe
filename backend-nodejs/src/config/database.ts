import neo4j, { Driver } from "neo4j-driver";

export interface DatabaseConfig {
  uri: string;
  username: string;
  password: string;
}

export function createDatabaseConnection(config: DatabaseConfig): Driver {
  const driver = neo4j.driver(
    config.uri,
    neo4j.auth.basic(config.username, config.password)
  );

  return driver;
}

export function getDatabaseConfig(): DatabaseConfig {
  return {
    uri: process.env.NEO4J_URI || "neo4j://127.0.0.1:7687",
    username: process.env.NEO4J_USER || "neo4j",
    password: process.env.NEO4J_PASSWORD || "password",
  };
}
