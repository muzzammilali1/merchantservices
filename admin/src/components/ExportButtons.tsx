interface Props {
  csvUrl: string;
  pdfUrl: string;
  label?: string;
}

export function ExportButtons({ csvUrl, pdfUrl, label = "Export" }: Props) {
  return (
    <div className="export-buttons">
      <span className="export-label">{label}:</span>
      <a className="btn-secondary btn-small" href={csvUrl} target="_blank" rel="noreferrer">
        CSV
      </a>
      <a className="btn-secondary btn-small" href={pdfUrl} target="_blank" rel="noreferrer">
        PDF
      </a>
    </div>
  );
}
