class ActorInitializer {
    static NewHero(position: Point) : Actor {
        let a = new Actor('Hero', position, true);
        a.actorType = ActorType.Hero;

        a.inventory = new Inventory();

        a.hitpoints = 25;
        a.damage = 3;
        // a.visionRange = 10;
        a.lightSourceRange = 10;

        return a;
    }

    static NewMonster(position: Point) : Actor {
        let a = new Actor('Monster', position, true);
        a.actorType = ActorType.Npc;

        a.hitpoints = 5;
        a.damage = 2;
        // a.visionRange = 5;
        a.hiddenUnderFog = true;

        return a;
    }

    static NewWall(position: Point) : Actor {
        let a = new Actor('Wall', position, true);
        a.actorType = ActorType.Wall;

        a.blocksLight = true;
        a.blocksVision = true;

        return a;
    }

    static NewDoor(position: Point) : Actor {
        let a = new Actor('Door', position, true);
        a.actorType = ActorType.Door;

        a.blocksLight = true;
        a.blocksVision = true;

        return a;
    }

    static NewTorch(position: Point) : Actor {
        let a = new Actor('Torch', position, true);
        a.actorType = ActorType.Wall;

        a.lightSourceRange = 3;

        return a;
    }

    static NewFloor(position: Point) : Actor {
        let a = new Actor('Floor', position);
        a.actorType = ActorType.Floor;

        return a;
    }

    static NewGold(position: Point) : Actor {
        let a = new Actor('Gold', position);
        a.actorType = ActorType.Item;

        a.gold = 5;

        return a;
    }

    static NewChest(position: Point) : Actor {
        let a = new Actor('Chest', position, true);
        a.actorType = ActorType.Chest;

        a.chestItem = new Item();

        return a;
    }
}