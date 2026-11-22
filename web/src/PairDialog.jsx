import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

export default function PairDialog({ open, onClose, uri, qrUri }) {
  const ref = useRef(null);
  const [img, setImg] = useState('');
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => { if (qrUri) QRCode.toDataURL(qrUri, { margin: 1, width: 280, errorCorrectionLevel: 'M' }).then(setImg); }, [qrUri]);
  return (
    <dialog ref={ref} className="pair" onClose={onClose} aria-labelledby="pair-title">
      <div className="qr">
        <h3 id="pair-title" style={{ margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: '-0.04em', textTransform: 'lowercase' }}>pair your wallet</h3>
        <p className="sub" style={{ margin: 0, textAlign: 'center' }}>Scan with a WizardConnect wallet such as Paytaca or Cashonize. On a phone, open the link instead.</p>
        {img ? <img src={img} alt="WizardConnect pairing code" width="280" height="280" /> : <div className="skeleton" style={{ width: 280, height: 280 }} />}
        {uri && <a className="btn" href={uri}>Open in wallet app</a>}
        {uri && <code>{uri}</code>}
        <button className="btn small" onClick={onClose}>Close</button>
      </div>
    </dialog>
  );
}
