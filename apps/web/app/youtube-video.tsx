export function YouTubeVideo({ url, title }: { url: string; title: string }) {
  const id = /^https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})$/.exec(url)?.[1];
  return id ? <iframe src={`https://www.youtube-nocookie.com/embed/${id}`} title={title}
    loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" sandbox="allow-scripts allow-same-origin allow-presentation"
    referrerPolicy="strict-origin-when-cross-origin" allowFullScreen /> : null;
}
