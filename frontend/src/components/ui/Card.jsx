
export default function Card({title,children,action}) {
 return (
  <div className="bg-white border rounded-xl p-4 shadow-sm">
    <div className="flex justify-between mb-3">
      <h2 className="font-semibold">{title}</h2>
      {action}
    </div>
    {children}
  </div>
 );
}
