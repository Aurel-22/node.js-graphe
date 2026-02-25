import express, { Request, Response } from "express";
import { GraphDatabaseService } from "../services/GraphDatabaseService.js";

export function createDatabaseRoutes(service: GraphDatabaseService) {
  const router = express.Router();

  // Lister toutes les databases
  router.get("/", async (req: Request, res: Response) => {
    try {
      const databases = await service.listDatabases();
      res.json(databases);
    } catch (error: any) {
      console.error("Error listing databases:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Créer une nouvelle database
  router.post("/", async (req: Request, res: Response) => {
    try {
      const { name } = req.body;

      if (!name) {
        return res.status(400).json({ error: "Database name is required" });
      }

      // Valider le nom de la database (lettres, chiffres, underscores seulement)
      if (!/^[a-zA-Z0-9_]+$/.test(name)) {
        return res.status(400).json({ 
          error: "Database name can only contain letters, numbers, and underscores" 
        });
      }

      await service.createDatabase(name);
      res.json({ message: `Database ${name} created successfully`, name });
    } catch (error: any) {
      console.error("Error creating database:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Supprimer une database
  router.delete("/:name", async (req: Request, res: Response) => {
    try {
      const { name } = req.params;

      await service.deleteDatabase(name);
      res.json({ message: `Database ${name} deleted successfully` });
    } catch (error: any) {
      console.error("Error deleting database:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Obtenir les statistiques d'une database
  router.get("/:name/stats", async (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const stats = await service.getDatabaseStats(name);
      res.json(stats);
    } catch (error: any) {
      console.error("Error getting database stats:", error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
