import axios from 'axios';

const api = axios.create({
    baseURL: 'http://127.0.0.1:8000/api/', // Backend API URL
});

export const createRoom = (roomData) => api.post('/rooms/', roomData);
export const fetchRooms = () => api.get('/rooms/');
export const updateRoom = (roomId, updateData) => api.put(`/rooms/${roomId}/`, updateData);
export const deleteRoom = (roomId) => api.delete(`/rooms/${roomId}/`);

export default api;