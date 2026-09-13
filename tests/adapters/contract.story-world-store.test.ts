import { createMockStoryWorldStore } from "../mocks";
import { runStoryWorldStoreContract } from "./support/story-world-store-contract";

runStoryWorldStoreContract(() => createMockStoryWorldStore());