export const addNotification = (
  notifications,
  message
) => {

  return [
    {
      id: Date.now(),
      message,
      time: new Date().toLocaleTimeString(),
    },
    ...notifications,
  ];

};

export const clearNotifications = () => {
  return [];
};

export const getNotificationCount = (
  notifications
) => {
  return notifications.length;
};

export const formatNotificationId = (id, role) => {
  const normalizedRole = String(role || '').trim().toLowerCase();
  const prefix = normalizedRole === 'admin' ? 'A' : normalizedRole === 'contributor' ? 'CB' : 'CS';
  return `#${prefix}-${String(id).padStart(3, '0')}`;
};