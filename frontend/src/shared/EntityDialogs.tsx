import { AlertTriangle, Trash2 } from "lucide-react";
import { Button, Input, Modal } from "antd";
import { useEffect, useState, type ReactNode } from "react";

export function EntityModal({ open, title, description, busy = false, confirmText = "创建", confirmDisabled = false, width = 500, onCancel, onConfirm, children }: {
  open: boolean;
  title: string;
  description?: string;
  busy?: boolean;
  confirmText?: string;
  confirmDisabled?: boolean;
  width?: number;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  children: ReactNode;
}) {
  return (
    <Modal
      className="entity-modal"
      open={open}
      width={width}
      centered
      destroyOnHidden
      title={<DialogTitle title={title} description={description} />}
      onCancel={onCancel}
      footer={[
        <Button key="cancel" onClick={onCancel} disabled={busy}>取消</Button>,
        <Button key="confirm" type="primary" loading={busy} disabled={confirmDisabled} onClick={() => void onConfirm()}>{confirmText}</Button>
      ]}
    >
      <div className="entity-modal-body">{children}</div>
    </Modal>
  );
}

export function ConfirmActionDialog({ open, title, description, subject, confirmText = "确认", danger = false, busy = false, onCancel, onConfirm }: {
  open: boolean;
  title: string;
  description: string;
  subject?: string;
  confirmText?: string;
  danger?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <Modal
      className="entity-modal confirm-action-modal"
      open={open}
      width={460}
      centered
      destroyOnHidden
      title={null}
      onCancel={onCancel}
      footer={[
        <Button key="cancel" onClick={onCancel} disabled={busy}>取消</Button>,
        <Button key="confirm" type="primary" danger={danger} loading={busy} onClick={() => void onConfirm()}>{confirmText}</Button>
      ]}
    >
      <div className={`confirm-action-content ${danger ? "danger" : "warning"}`}>
        <span className="confirm-action-icon">{danger ? <Trash2 size={21} /> : <AlertTriangle size={21} />}</span>
        <div><h3>{title}</h3>{subject ? <strong>{subject}</strong> : null}<p>{description}</p></div>
      </div>
    </Modal>
  );
}

export function TextEntryDialog({ open, title, description, label, initialValue = "", placeholder, confirmText = "保存", multiline = false, busy = false, onCancel, onConfirm }: {
  open: boolean;
  title: string;
  description?: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  confirmText?: string;
  multiline?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (value: string) => void | Promise<void>;
}) {
  const [value, setValue] = useState(initialValue);
  useEffect(() => { if (open) setValue(initialValue); }, [open, initialValue]);
  return (
    <EntityModal
      open={open}
      title={title}
      description={description}
      busy={busy}
      confirmText={confirmText}
      confirmDisabled={!value.trim()}
      onCancel={onCancel}
      onConfirm={() => onConfirm(value.trim())}
    >
      <label className="entity-field"><span>{label}</span>{multiline
        ? <Input.TextArea autoFocus value={value} rows={5} placeholder={placeholder} onChange={(event) => setValue(event.target.value)} />
        : <Input autoFocus value={value} placeholder={placeholder} onChange={(event) => setValue(event.target.value)} onPressEnter={() => value.trim() && void onConfirm(value.trim())} />}</label>
    </EntityModal>
  );
}

function DialogTitle({ title, description }: { title: string; description?: string }) {
  return <div className="entity-modal-title"><strong>{title}</strong>{description ? <span>{description}</span> : null}</div>;
}
