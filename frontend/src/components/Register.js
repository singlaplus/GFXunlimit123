import { useState } from "react";
import axios from "axios";

function Register() {

  const [username, setUsername] =
    useState("");

  const [email, setEmail] =
    useState("");

  const [password, setPassword] =
    useState("");
    const [fullName, setFullName] =
  useState("");

const [confirmPassword, setConfirmPassword] =
  useState("");

const [identityNumber, setIdentityNumber] =
  useState("");

const [agreeTerms, setAgreeTerms] =
  useState(false);

const [agreeContributor, setAgreeContributor] =
  useState(false);

  const handleRegister = async (e) => {

    e.preventDefault();

    try {

      await axios.post(

        `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/register`,

        {
          username,
          email,
          password,
        }

      );

      alert("Registration successful");

    } catch (err) {

      console.error(err);

      alert("Registration failed");
    }
  };

  return (

    <div
      style={{
        border: "1px solid #ccc",
        padding: "20px",
        borderRadius: "10px",
        marginBottom: "20px",
      }}
    >

      <h2>Register</h2>

      <form onSubmit={handleRegister}>

        <input
  type="text"
  placeholder="Full Name"
  value={fullName}
  onChange={(e) =>
    setFullName(e.target.value)
  }
  style={{
    width: "100%",
    padding: "10px",
    marginBottom: "10px",
  }}
/>
        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) =>
            setUsername(e.target.value)
          }
          style={{
            width: "100%",
            padding: "10px",
            marginBottom: "10px",
          }}
        />

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) =>
            setEmail(e.target.value)
          }
          style={{
            width: "100%",
            padding: "10px",
            marginBottom: "10px",
          }}
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) =>
            setPassword(e.target.value)
          }
          style={{
            width: "100%",
            padding: "10px",
            marginBottom: "10px",
          }}
        />
        <input
  type="password"
  placeholder="Confirm Password"
  value={confirmPassword}
  onChange={(e) =>
    setConfirmPassword(e.target.value)
  }
  style={{
    width: "100%",
    padding: "10px",
    marginBottom: "10px",
  }}
/>

        <button
          type="submit"
          style={{
            padding: "10px 20px",
            background: "green",
            color: "white",
            border: "none",
            borderRadius: "5px",
            cursor: "pointer",
          }}
        >
          Register
        </button>

      </form>

    </div>

  );
}

export default Register;