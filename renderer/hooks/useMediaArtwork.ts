// hooks/useMediaArtwork.ts
import { parseBlob } from "music-metadata-browser";
import { useEffect } from "react";
import { VideoQueueAction } from "../store/videoQueueReducer";
import { VideoItem } from "../types/videoTypes";

const AUDIO_EXTENSIONS = ["mp3", "m4a", "aac", "flac", "wav"];

export const useMediaArtwork = (
  videoQueue: VideoItem[],
  dispatch: React.Dispatch<VideoQueueAction>,
) => {
  useEffect(() => {
    // 取得済みアートワークを記録するMapを作成
    const processedUrls = new Map<string, boolean>();
    // アートワーク取得処理を並列数制限付きで実行
    const fetchArtworkBatch = async () => {
      // 一度に処理する最大数
      const BATCH_SIZE = 3;
      const pendingItems = videoQueue.filter(
        (item, index) =>
          !item.artworkUrl &&
          AUDIO_EXTENSIONS.includes(item.ext) &&
          !processedUrls.has(item.url),
      );

      // バッチ処理
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
    // 個別のアートワーク取得処理
    const fetchArtwork = async (item: VideoItem, index: number) => {
      // 処理済みとしてマーク
      processedUrls.set(item.url, true);

      try {
        const res = await fetch(item.url);
        const blob = await res.blob();
        const metadata = await parseBlob(blob);
        const artist = metadata.common.artist ?? "";
        const album = metadata.common.album ?? "";

        if (artist || album) {
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
                      metadata,
                      type: "UPDATE_MEDIA_INFO",
                    });

                    return;
                  }
                } catch (error) {
                  console.error(
                    `Artwork search error (${term}/${entity}/${country}):`,
                    error,
                  );
                  // エラーが発生しても次の検索を続行
                }
              }
            }
          }
        }
      } catch (error) {
        console.error("Metadata fetch error:", error);
      }
    };

    if (videoQueue.length > 0) {
      void fetchArtworkBatch();
    }

    // クリーンアップ関数
    return () => {
      // 取得処理をキャンセルする必要がある場合はここに実装
    };
  }, [videoQueue, dispatch]);
};
