import { useState } from "react";
import RegistrationForm from "./RegistrationForm";
function JoinModal({ show, onClose, accountType: initialAccountType, setAccountType: setExternalAccountType }) {
    const [step, setStep] = useState("choose");
const [accountType, setAccountType] = useState(initialAccountType || "");
const [registrationComplete, setRegistrationComplete] = useState(false);
const handleClose = () => {
  setStep("choose");
  setAccountType(initialAccountType || "");
  if (setExternalAccountType) {
    setExternalAccountType(initialAccountType || "");
  }
  setRegistrationComplete(false);

  onClose();
};
  if (!show) return null;
  if (step === "benefits") {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 9999,
      }}
    >
      <div
        style={{
          background: "white",
          width: "700px",
          borderRadius: "15px",
          padding: "35px",
        }}
      >
        <h2 style={{ color: "#ED2224" }}>
          {accountType === "contributor"
            ? "📷 Become a GFXunlimit Contributor"
            : "🛒 Join GFXunlimit as a Customer"}
        </h2>

        {accountType === "contributor" ? (
          <>
            <p>✔ Earn money from every download</p>

            <p>✔ Build your professional portfolio</p>

            <p>✔ View detailed analytics</p>

            <p>✔ Level up and earn contributor badges</p>

            <p>✔ Reach customers worldwide</p>
          </>
        ) : (
          <>
            <p>✔ Download premium images</p>

            <p>✔ Save unlimited favorites</p>

            <p>✔ Create collections</p>

            <p>✔ Purchase licenses securely</p>

            <p>✔ Fast downloads</p>
          </>
        )}

        <div
          style={{
            marginTop: "30px",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <button
            onClick={() => setStep("choose")}
            style={{
              padding: "8px 16px",
              background: "#111",
              color: "white",
              border: "1px solid #111",
              borderRadius: "8px",
              cursor: "pointer",
            }}
          >
            ← Back
          </button>

          <button
  onClick={() => setStep("register")}
  style={{
    background: "#ED2224",
    color: "white",
    padding: "10px 25px",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
  }}
>
  Continue →
</button>
        </div>
      </div>
    </div>
  );
}
if (registrationComplete) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 9999,
      }}
    >
      <div
        style={{
          background: "white",
          padding: "40px",
          width: "500px",
          borderRadius: "15px",
          textAlign: "center",
        }}
      >
        <h2 style={{ color: "#ED2224" }}>
          🎉 Registration Successful
        </h2>

        {accountType === "customer" ? (
          <>
            <p>Your account has been created.</p>

            <p>Please log in to continue.</p>
          </>
        ) : (
          <>
            <p>Your contributor application has been submitted.</p>

            <p>
              Your account will become active after admin approval
              or within 24 hours.
            </p>
          </>
        )}

        <button
          onClick={handleClose}
          style={{
            marginTop: "20px",
            padding: "10px 30px",
            background: "#ED2224",
            color: "white",
            border: "none",
            borderRadius: "8px",
            cursor: "pointer",
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
if (step === "register") {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 9999,
      }}
    >
      <div
        style={{
          background: "white",
          width: "700px",
          borderRadius: "15px",
          padding: "35px",
          position: "relative",
        }}
      >
        <button
          onClick={() => setStep("benefits")}
          style={{
            position: "absolute",
            top: 15,
            left: 20,
            padding: "8px 16px",
            background: "#111",
            color: "white",
            border: "1px solid #111",
            borderRadius: "8px",
            cursor: "pointer",
            fontSize: "18px",
          }}
        >
          ← Back
        </button>

        <button
          onClick={handleClose}
          style={{
            position: "absolute",
            top: 15,
            right: 20,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            fontSize: "22px",
          }}
        >
          ✖
        </button>

        <RegistrationForm
  accountType={accountType}
  onSuccess={() => {
    setRegistrationComplete(true);
  }}
/>
      </div>
    </div>
  );
}

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 9999,
      }}
    >
      <div
        style={{
          background: "white",
          width: "700px",
          borderRadius: "15px",
          padding: "30px",
          position: "relative",
        }}
      >
        <button
          onClick={handleClose}
          style={{
            position: "absolute",
            top: 15,
            right: 20,
            border: "none",
            background: "transparent",
            fontSize: "22px",
            cursor: "pointer",
          }}
        >
          ✖
        </button>

        <h2
          style={{
            textAlign: "center",
            marginBottom: "30px",
          }}
        >
          Join GFXunlimit
        </h2>

        <p
          style={{
            textAlign: "center",
            color: "#666",
            marginBottom: "35px",
          }}
        >
          Choose how you'd like to use GFXunlimit.
        </p>

        <div
          style={{
            display: "flex",
            gap: "20px",
          }}
        >
          <div
            style={{
              flex: 1,
              border: "1px solid #ddd",
              borderRadius: "12px",
              padding: "25px",
              textAlign: "center",
            }}
          >
            <h2>📷 Contributor</h2>

            <p>
              Upload your work and earn money from downloads.
            </p>

            <button
  onClick={() => {
    setAccountType("contributor");
    if (setExternalAccountType) {
      setExternalAccountType("contributor");
    }
    setStep("benefits");
  }}
  style={{
    padding: "10px 20px",
    background: "#ED2224",
    color: "white",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    marginTop: "15px",
  }}
>
  Continue
</button>
          </div>

          <div
            style={{
              flex: 1,
              border: "1px solid #ddd",
              borderRadius: "12px",
              padding: "25px",
              textAlign: "center",
            }}
          >
            <h2>🛒 Customer</h2>

            <p>
              Download images and build collections.
            </p>

            <button
  onClick={() => {
    setAccountType("customer");
    if (setExternalAccountType) {
      setExternalAccountType("customer");
    }
    setStep("benefits");
  }}
  style={{
    padding: "10px 20px",
    background: "#ED2224",
    color: "white",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    marginTop: "15px",
  }}
>
  Continue
</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default JoinModal;