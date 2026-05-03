/**
 * HyDE (Hypothetical Document Embeddings) Fallback
 *
 * When a query returns sparse results, HyDE generates a hypothetical memory
 * that would perfectly answer the query, then embeds that hypothetical document
 * instead of the raw query. This improves retrieval for underspecified queries.
 *
 * Reference: "Precise Zero-Shot Dense Retrieval without Relevance Labels"
 * (Gao et al., 2022)
 */

import { generateText } from 'ai';
import type { LanguageModel } from 'ai';
import type { EmbeddingService } from '../embedding-service';

/**
 * Generate a hypothetical memory embedding for a query using HyDE.
 *
 * @param query - The search query
 * @param embeddingService - Service for computing the final embedding
 * @param model - Language model for generating hypothetical document
 * @returns 1024-dim embedding of the hypothetical document
 */
export async function hydeSearch(
  query: string,
  embeddingService: EmbeddingService,
  model: LanguageModel,
): Promise<number[]> {
  try {
    const { text } = await generateText({
      model,
      prompt: `Write a 2-sentence memory entry that would perfectly answer this query: "${query}"

The memory should be written as a factual observation about code, architecture, or development patterns.`,
      maxOutputTokens: 100,
    });

    // Embed the hypothetical document
    return embeddingService.embed(text.trim() || query, 1024);
  } catch {
    // If generation fails, fall back to embedding the original query
    return embeddingService.embed(query, 1024);
  }
}
