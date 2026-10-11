import { Dialog } from "../components/Dialog";

export function ConflictDialog({
  onReload,
  onOverwrite,
}: {
  onReload: () => void;
  onOverwrite: () => void;
}) {
  return (
    <Dialog title="Bài vừa được sửa ở nơi khác">
      <p>Bản trên máy chủ mới hơn bản bạn đang sửa (có thể ở một tab khác).</p>
      <div className="dialog-actions">
        <button type="button" onClick={onReload}>
          Tải lại bản mới
        </button>
        <button type="button" className="btn-danger" onClick={onOverwrite}>
          Ghi đè bằng bản của tôi
        </button>
      </div>
    </Dialog>
  );
}
