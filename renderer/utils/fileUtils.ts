import { type VideoItem } from "@/store/videoQueueReducer";

export function extractVideoItemsFromDrop(e: React.DragEvent): VideoItem[] {
  e.preventDefault();

  const files = Array.from(e.dataTransfer.files || []);

  return files
    .filter(
      (file) =>
        file.type.startsWith("video/") || file.type.startsWith("audio/"),
    )
    .map((file) => {
      const [baseName, ext] = file.name.split(/\.(?=[^.]+$)/);
      const url = URL.createObjectURL(file);

      return { ext, name: baseName, url };
    });
}
