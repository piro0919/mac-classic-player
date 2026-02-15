// hooks/useMediaArtwork.ts
// メタデータは読み込み時に解析済み（useTauriEvents / useMediaFiles）
// このフックはiTunesからアートワークを検索・取得する
import { useEffect } from "react";
import type { VideoQueueAction } from "../store/videoQueueReducer";
import type { VideoItem } from "../types/videoTypes";

export const useMediaArtwork = (
  videoQueue: VideoItem[],
  dispatch: React.Dispatch<VideoQueueAction>,
) => {
  useEffect(() => {
    const processedUrls = new Map<string, boolean>();

    const fetchArtworkBatch = async () => {
      const BATCH_SIZE = 3;
      // メタデータがあり、アートワークがまだ取得されていないアイテムを抽出
      const pendingItems = videoQueue.filter(
        (item) =>
          !item.artworkUrl &&
          item.metadata &&
          !processedUrls.has(item.url),
      );

      for (let i = 0; i < pendingItems.length; i += BATCH_SIZE) {
        const batch = pendingItems.slice(i, i + BATCH_SIZE);

        await Promise.all(
          batch.map(async (item) => {
            const index = videoQueue.findIndex((vq) => vq.url === item.url);

            return fetchArtwork(item, index);
          }),
        );
      }
    };

    const fetchArtwork = async (item: VideoItem, index: number) => {
      processedUrls.set(item.url, true);

      const metadata = item.metadata;

      if (!metadata) return;

      const artist = metadata.common.artist ?? "";
      const album = metadata.common.album ?? "";

      if (!artist && !album) return;

      const lang = navigator.language.toLowerCase();
      const countries = lang.startsWith("ja") ? ["JP", "US"] : ["US"];

      for (const country of countries) {
        for (const term of [`${artist} ${album}`, artist, album]) {
          for (const entity of ["song", "album"]) {
            try {
              const res = await fetch(
                `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=${entity}&country=${country}&limit=1`,
              );

              if (!res.ok) continue;

              const data = await res.json();

              if (data?.results?.[0]?.artworkUrl100) {
                const artworkUrl = data.results[0].artworkUrl100.replace(
                  "100x100",
                  "600x600",
                );

                dispatch({
                  artworkUrl,
                  index,
                  type: "UPDATE_MEDIA_INFO",
                });

                return;
              }
            } catch (error) {
              console.error(
                `Artwork search error (${term}/${entity}/${country}):`,
                error,
              );
            }
          }
        }
      }
    };

    if (videoQueue.length > 0) {
      void fetchArtworkBatch();
    }

    return () => {
      // クリーンアップ
    };
  }, [videoQueue, dispatch]);
};
