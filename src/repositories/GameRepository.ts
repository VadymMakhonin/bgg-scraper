import { PrismaService } from '../database/PrismaService';
import { 
  Game, 
  GameCreateData, 
  GameWithDetails, 
  CommunityData,
  LanguageDependence,
  Category,
  Mechanism,
  Family 
} from '../models/Game';

export class GameRepository {
  private prisma = PrismaService.getInstance().prisma;

  async findOrCreateLanguageDependence(text: string): Promise<LanguageDependence> {
    return await this.prisma.languageDependence.upsert({
      where: { text },
      update: {},
      create: { text }
    });
  }

  async findOrCreateCategory(name: string): Promise<Category> {
    return await this.prisma.category.upsert({
      where: { name },
      update: {},
      create: { name }
    });
  }

  async findOrCreateMechanism(name: string): Promise<Mechanism> {
    return await this.prisma.mechanism.upsert({
      where: { name },
      update: {},
      create: { name }
    });
  }

  async findOrCreateFamily(name: string): Promise<Family> {
    return await this.prisma.family.upsert({
      where: { name },
      update: {},
      create: { name }
    });
  }

  async createGame(gameData: GameCreateData): Promise<Game> {
    const {
      rank, name, bggUrl, year, minPlayers, maxPlayers,
      minPlayingTime, maxPlayingTime, weight, languageDependenceText,
      officialAge, categories, mechanisms, families
    } = gameData;

    return await this.prisma.$transaction(async (tx) => {
      // Handle language dependence
      let languageDependenceId: number | null = null;
      if (languageDependenceText) {
        const langDep = await tx.languageDependence.upsert({
          where: { text: languageDependenceText },
          update: {},
          create: { text: languageDependenceText }
        });
        languageDependenceId = langDep.id;
      }

      // Create the game
      const game = await tx.game.create({
        data: {
          rank,
          name,
          bggUrl,
          year,
          minPlayers,
          maxPlayers,
          minPlayingTime,
          maxPlayingTime,
          weight,
          languageDependenceId,
          officialAge
        }
      });

      // Handle categories
      for (const categoryName of categories) {
        const category = await tx.category.upsert({
          where: { name: categoryName },
          update: {},
          create: { name: categoryName }
        });
        await tx.gameCategory.create({
          data: {
            gameId: game.id,
            categoryId: category.id
          }
        });
      }

      // Handle mechanisms
      for (const mechanismName of mechanisms) {
        const mechanism = await tx.mechanism.upsert({
          where: { name: mechanismName },
          update: {},
          create: { name: mechanismName }
        });
        await tx.gameMechanism.create({
          data: {
            gameId: game.id,
            mechanismId: mechanism.id
          }
        });
      }

      // Handle families
      for (const familyName of families) {
        const family = await tx.family.upsert({
          where: { name: familyName },
          update: {},
          create: { name: familyName }
        });
        await tx.gameFamily.create({
          data: {
            gameId: game.id,
            familyId: family.id
          }
        });
      }

      return game;
    });
  }

  async updateGameWithCommunityData(gameId: number, communityData: CommunityData): Promise<void> {
    const { playerRatings = [], ageRatings = [] } = communityData;

    await this.prisma.$transaction(async (tx) => {
      // Batch all community data operations
      const communityOperations = [
        // Player ratings batch
        ...playerRatings.map(rating => 
          tx.communityPlayerRating.upsert({
            where: {
              gameId_playerCount: {
                gameId: gameId,
                playerCount: rating.playerCount
              }
            },
            update: {
              bestPercentage: rating.bestPercentage,
              recommendedPercentage: rating.recommendedPercentage,
              notRecommendedPercentage: rating.notRecommendedPercentage,
              totalVotes: rating.totalVotes
            },
            create: {
              gameId: gameId,
              playerCount: rating.playerCount,
              bestPercentage: rating.bestPercentage,
              recommendedPercentage: rating.recommendedPercentage,
              notRecommendedPercentage: rating.notRecommendedPercentage,
              totalVotes: rating.totalVotes
            }
          })
        ),

        // Age ratings batch
        ...ageRatings.map(ageRating => 
          tx.communityAgeRating.upsert({
            where: {
              gameId_age: {
                gameId: gameId,
                age: ageRating.age
              }
            },
            update: {
              percentage: ageRating.percentage,
              voteCount: ageRating.voteCount
            },
            create: {
              gameId: gameId,
              age: ageRating.age,
              percentage: ageRating.percentage,
              voteCount: ageRating.voteCount
            }
          })
        )
      ];

      // Execute all community data operations in parallel
      await Promise.all(communityOperations);
    });
  }

  async findByBggUrl(bggUrl: string): Promise<Game | null> {
    return await this.prisma.game.findUnique({
      where: { bggUrl }
    });
  }

  async findById(id: number): Promise<Pick<Game, 'id' | 'bggUrl' | 'name'> | null> {
    return await this.prisma.game.findUnique({
      where: { id },
      select: {
        id: true,
        bggUrl: true,
        name: true
      }
    });
  }

  async findAllWithoutDetails(): Promise<Pick<Game, 'id' | 'bggUrl' | 'name'>[]> {
    return await this.prisma.game.findMany({
      where: {
        OR: [
          // Games without weight (basic details missing)
          { weight: null },
          // Games without categories AND mechanisms AND families (relationship data missing)
          {
            AND: [
              { gameCategories: { none: {} } },
              { gameMechanisms: { none: {} } },
              { gameFamilies: { none: {} } }
            ]
          }
        ]
      },
      select: {
        id: true,
        bggUrl: true,
        name: true
      }
    });
  }

  async claimGamesForProcessing(workerId: string, batchSize: number = 10): Promise<Pick<Game, 'id' | 'bggUrl' | 'name'>[]> {
    // Use a transaction to atomically claim games
    return await this.prisma.$transaction(async (tx) => {
      // Find games that need processing and aren't being processed (same logic as findAllWithoutDetails)
      const availableGames = await tx.game.findMany({
        where: {
          AND: [
            { processingBy: null },
            {
              OR: [
                // Games without weight (basic details missing)
                { weight: null },
                // Games without categories AND mechanisms AND families (relationship data missing)
                {
                  AND: [
                    { gameCategories: { none: {} } },
                    { gameMechanisms: { none: {} } },
                    { gameFamilies: { none: {} } }
                  ]
                }
              ]
            }
          ]
        },
        select: {
          id: true,
          bggUrl: true,
          name: true
        },
        take: batchSize,
        orderBy: {
          id: 'asc'
        }
      });

      if (availableGames.length === 0) {
        return [];
      }

      // Claim these games for this worker
      const gameIds = availableGames.map(game => game.id);
      await tx.game.updateMany({
        where: {
          id: { in: gameIds }
        },
        data: {
          processingBy: workerId,
          processingAt: new Date()
        }
      });

      return availableGames;
    });
  }

  async releaseClaimedGames(workerId: string): Promise<void> {
    // Release any games claimed by this worker (in case of crash/restart)
    await this.prisma.game.updateMany({
      where: {
        processingBy: workerId
      },
      data: {
        processingBy: null,
        processingAt: null
      }
    });
  }

  async releaseAllClaimedGames(): Promise<{ count: number }> {
    // Release all claimed games from any worker (cleanup before starting)
    const result = await this.prisma.game.updateMany({
      where: {
        processingBy: { not: null }
      },
      data: {
        processingBy: null,
        processingAt: null
      }
    });
    
    return { count: result.count };
  }

  async findAllWithDetails(): Promise<GameWithDetails[]> {
    const games = await this.prisma.game.findMany({
      include: {
        languageDependence: true,
        communityPlayerRatings: true,
        communityAgeRatings: true,
        gameCategories: {
          include: {
            category: true
          }
        },
        gameMechanisms: {
          include: {
            mechanism: true
          }
        },
        gameFamilies: {
          include: {
            family: true
          }
        }
      }
    });

    return games.map(game => ({
      ...game,
      categories: game.gameCategories.map(gc => gc.category.name),
      mechanisms: game.gameMechanisms.map(gm => gm.mechanism.name),
      families: game.gameFamilies.map(gf => gf.family.name)
    }));
  }

  async getStats(): Promise<{
    totalGames: number;
    gamesWithDetails: number;
    gamesWithCommunityData: number;
    pendingDetails: number;
  }> {
    const totalGames = await this.prisma.game.count();
    const gamesWithDetails = await this.prisma.game.count({
      where: {
        weight: { not: null }
      }
    });
    const gamesWithCommunityData = await this.prisma.game.count({
      where: {
        communityPlayerRatings: {
          some: {}
        }
      }
    });

    return {
      totalGames,
      gamesWithDetails,
      gamesWithCommunityData,
      pendingDetails: totalGames - gamesWithDetails
    };
  }

  async updateGameWithAllDetails(gameId: number, details: {
    year: number | null;
    minPlayers: number | null;
    maxPlayers: number | null;
    minPlayingTime: number | null;
    maxPlayingTime: number | null;
    weight: number | null;
    officialAge: number | null;
    languageDependenceText: string | null;
    categories: string[];
    mechanisms: string[];
    families: string[];
    communityPlayerRatings: {
      playerCount: number;
      bestPercentage: number | null;
      recommendedPercentage: number | null;
      notRecommendedPercentage: number | null;
      totalVotes: number | null;
    }[];
    communityAgeRatings: {
      age: number;
      percentage: number | null;
      voteCount: number | null;
    }[];
  }): Promise<void> {
    // Step 1: Parallelize all lookups outside the transaction
    const [
      languageDependenceId,
      categoryIds,
      mechanismIds,
      familyIds
    ] = await Promise.all([
      // Language dependence lookup
      details.languageDependenceText 
        ? this.findOrCreateLanguageDependence(details.languageDependenceText).then(lang => lang.id)
        : Promise.resolve(null),
      
      // Parallel category lookups
      Promise.all(
        details.categories.map(name => 
          this.findOrCreateCategory(name).then(cat => ({ name, id: cat.id }))
        )
      ),
      
      // Parallel mechanism lookups
      Promise.all(
        details.mechanisms.map(name => 
          this.findOrCreateMechanism(name).then(mech => ({ name, id: mech.id }))
        )
      ),
      
      // Parallel family lookups
      Promise.all(
        details.families.map(name => 
          this.findOrCreateFamily(name).then(fam => ({ name, id: fam.id }))
        )
      )
    ]);

    // Step 2: Fast transaction with only the actual updates
    await this.prisma.$transaction(async (tx) => {
      // Update basic game info
      await tx.game.update({
        where: { id: gameId },
        data: {
          year: details.year,
          minPlayers: details.minPlayers,
          maxPlayers: details.maxPlayers,
          minPlayingTime: details.minPlayingTime,
          maxPlayingTime: details.maxPlayingTime,
          weight: details.weight,
          officialAge: details.officialAge,
          languageDependenceId: languageDependenceId,
          scrapedAt: new Date()
        }
      });

      // Batch create relationship records
      const relationshipOperations = [
        // Categories batch
        ...categoryIds.map(category => 
          tx.gameCategory.upsert({
            where: {
              gameId_categoryId: {
                gameId: gameId,
                categoryId: category.id
              }
            },
            update: {},
            create: {
              gameId: gameId,
              categoryId: category.id
            }
          })
        ),
        
        // Mechanisms batch
        ...mechanismIds.map(mechanism => 
          tx.gameMechanism.upsert({
            where: {
              gameId_mechanismId: {
                gameId: gameId,
                mechanismId: mechanism.id
              }
            },
            update: {},
            create: {
              gameId: gameId,
              mechanismId: mechanism.id
            }
          })
        ),
        
        // Families batch
        ...familyIds.map(family => 
          tx.gameFamily.upsert({
            where: {
              gameId_familyId: {
                gameId: gameId,
                familyId: family.id
              }
            },
            update: {},
            create: {
              gameId: gameId,
              familyId: family.id
            }
          })
        )
      ];

      // Execute all relationship operations in parallel
      await Promise.all(relationshipOperations);
    });
    
    // Step 3: Update community data (also parallelized internally)
    await this.updateGameWithCommunityData(gameId, {
      playerRatings: details.communityPlayerRatings,
      ageRatings: details.communityAgeRatings
    });
  }
}