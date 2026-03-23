
import { create } from "zustand";
export const useAuthStore = create((set)=>({
 token: localStorage.getItem("token"),
 user:null,
 login:(d)=>{localStorage.setItem("token",d.token); set({token:d.token,user:d.user});},
 logout:()=>{localStorage.removeItem("token"); set({token:null,user:null});}
}));
