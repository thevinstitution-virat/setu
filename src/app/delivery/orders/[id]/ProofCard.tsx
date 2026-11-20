"use client";

import SignaturePad from "@/components/SignaturePad";
import Icon from "@/components/Icon";

/** Signature and delivery photo. The photo is required when the business says so. */
export default function ProofCard({
  photoRequired,
  photo,
  onPhotoAction,
  onSignatureAction,
}: {
  photoRequired: boolean;
  /** Data URL preview of the chosen photo. */
  photo: string | null;
  onPhotoAction: (file: File | null) => void;
  onSignatureAction: (dataUrl: string | null) => void;
}) {
  return (
    <div className="card p-4 space-y-3">
      <p className="text-sm font-semibold">Proof of delivery</p>
      <SignaturePad onChangeAction={onSignatureAction} />
      <label className={`btn w-full cursor-pointer ${photo ? "btn-quiet" : photoRequired ? "btn-mor" : "btn-outline"}`}>
        <Icon name="image" className="h-4 w-4" />
        {photo ? "Retake photo" : photoRequired ? "Take delivery photo (needed)" : "Take delivery photo (optional)"}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(e) => onPhotoAction(e.target.files?.[0] ?? null)}
        />
      </label>
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt="Proof of delivery" className="rounded-lg max-h-40" />
      )}
    </div>
  );
}
