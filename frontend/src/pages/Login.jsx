
import { useState } from "react";
import { login } from "../api/auth";
import { useAuthStore } from "../store/authStore";
import { useNavigate } from "react-router-dom";

export default function Login(){
 const [form,setForm]=useState({});
 const auth = useAuthStore();
 const nav = useNavigate();

 const submit = async ()=>{
   const res = await login(form);
   auth.login(res.data);
   nav("/");
 };

 return (
  <div className="flex h-screen items-center justify-center">
    <div className="border p-6 rounded">
      <input placeholder="email" onChange={e=>setForm({...form,email:e.target.value})}/>
      <input type="password" placeholder="password" onChange={e=>setForm({...form,password:e.target.value})}/>
      <button onClick={submit}>Login</button>
    </div>
  </div>
 );
}
