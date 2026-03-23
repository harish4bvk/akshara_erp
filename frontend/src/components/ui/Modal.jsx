
export default function Modal({isOpen,onClose,children}) {
 if(!isOpen) return null;
 return (
  <div className="fixed inset-0 bg-black/40 flex justify-center items-center">
    <div className="bg-white p-6 rounded-xl w-[400px]">
      {children}
      <button onClick={onClose} className="mt-4 text-sm text-gray-500">Close</button>
    </div>
  </div>
 );
}
